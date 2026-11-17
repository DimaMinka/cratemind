import * as fs from 'node:fs';
import * as path from 'node:path';
import { INCOMING_DIR, SORTED_DIR, AUDIO_EXTENSIONS } from '../../config.js';
import { extractMetadata } from '../ID3Service.js';
import { routeFile } from '../RoutingService.js';
import { invalidateCache, addExample } from '../RAGService.js';
import { useStore } from '../UIService.js';
import { getGlobalStats } from '../LocalDBService.js';
import {
  pocketCommitPayloadSchema,
  POCKET_VALID_FOLDERS,
  PocketCommitResult
} from './pocketTypes.js';

export interface ProcessCommitOptions {
  incomingDir?: string;
  sortedDir?: string;
}

export interface CommitError extends Error {
  statusCode?: number;
  activeTask?: string;
  issues?: unknown;
}

let commitMutex = Promise.resolve();

/**
 * Processes committed sorting decisions from CrateMind Pocket.
 * Enforces mutual exclusion, safe manual override, explicit skip,
 * file routing, and RAG cache coherence. Serializes executions to prevent races.
 */
export async function processCommit(
  payload: unknown,
  options?: ProcessCommitOptions
): Promise<PocketCommitResult> {
  const previousMutex = commitMutex;
  let releaseMutex: () => void;
  commitMutex = new Promise<void>((resolve) => {
    releaseMutex = resolve;
  });
  await previousMutex;
  try {
    return await executeCommit(payload, options);
  } finally {
    releaseMutex!();
  }
}

async function executeCommit(
  payload: unknown,
  options?: ProcessCommitOptions
): Promise<PocketCommitResult> {
  // 1. Mutual Exclusion Check
  const state = useStore.getState();
  const isBusy = Boolean(
    state.isTelegramDownloading ||
    state.isIndexingVibes ||
    state.driveSyncProgress?.isActive ||
    state.isLLMAnalyzing
  );

  if (isBusy) {
    let activeTask = 'Background task active';
    if (state.isTelegramDownloading) activeTask = 'Telegram downloading';
    else if (state.isIndexingVibes) activeTask = 'Vibes indexing';
    else if (state.driveSyncProgress?.isActive) activeTask = 'Drive syncing';
    else if (state.isLLMAnalyzing) activeTask = 'LLM analyzing';

    const err = new Error(
      `Conflict: system is busy with an active background task (${activeTask})`
    ) as CommitError;
    err.statusCode = 409;
    err.activeTask = activeTask;
    throw err;
  }

  // 2. Schema and Path Traversal Validation
  const parseResult = pocketCommitPayloadSchema.safeParse(payload);
  if (!parseResult.success) {
    const errorMessages = parseResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    const err = new Error(`Validation error: ${errorMessages}`) as CommitError;
    err.statusCode = 400;
    err.issues = parseResult.error.issues;
    throw err;
  }

  const validatedPayload = parseResult.data;

  for (const decision of validatedPayload.decisions) {
    const fn = decision.filename.trim();
    if (
      fn === '.' ||
      fn === '..' ||
      /^[.\s/\\]+$/.test(decision.filename) ||
      decision.filename.includes('..') ||
      decision.filename.includes('/') ||
      decision.filename.includes('\\') ||
      decision.filename.includes('\0') ||
      path.basename(decision.filename) !== decision.filename
    ) {
      const err = new Error(
        `Path traversal attempt detected in filename: ${decision.filename}`
      ) as CommitError;
      err.statusCode = 400;
      throw err;
    }

    for (const folder of decision.selectedFolders) {
      if (!(POCKET_VALID_FOLDERS as readonly string[]).includes(folder)) {
        const err = new Error(`Invalid crate folder name: ${folder}`) as CommitError;
        err.statusCode = 400;
        throw err;
      }
    }
  }

  const incomingDir = options?.incomingDir ?? path.resolve(INCOMING_DIR);
  const sortedDir = options?.sortedDir ?? path.resolve(SORTED_DIR);

  let processedCount = 0;
  let routedCount = 0;
  let skippedCount = 0;
  let pendingCount = 0;
  const errors: string[] = [];
  const examplesToAdd: Array<{
    artist: string;
    title: string;
    folders: string[];
  }> = [];

  for (const decision of validatedPayload.decisions) {
    processedCount++;
    const srcPath = path.join(incomingDir, decision.filename);

    if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) {
      errors.push(`File not found: ${decision.filename}`);
      continue;
    }

    // Branch 1: Safe manual override (Empty Routing / Pending)
    const isPending = decision.status === 'pending';
    const isEmptyTagged = decision.status === 'tagged' && decision.selectedFolders.length === 0;

    if (isPending || isEmptyTagged) {
      pendingCount++;
      useStore
        .getState()
        .addLog(
          'SYSTEM',
          `[Pocket] Safe manual override: ${decision.filename} left untouched in Incoming/`
        );
      continue;
    }

    // Branch 2: Explicit Skip
    const isExplicitSkip =
      decision.status === 'skipped' || decision.selectedFolders.includes('skipped');

    if (isExplicitSkip) {
      try {
        await routeFile(srcPath, ['skipped'], undefined, sortedDir);
        skippedCount++;
        useStore
          .getState()
          .addLog('ROUTED', `[Pocket] Skipped track -> /skipped/${decision.filename}`);
      } catch (routeErr) {
        const msg = routeErr instanceof Error ? routeErr.message : String(routeErr);
        errors.push(`Failed to skip ${decision.filename}: ${msg}`);
      }
      continue;
    }

    // Branch 3: Tagged Crates
    const targetCrates = decision.selectedFolders.filter((f) => f !== 'skipped');
    if (targetCrates.length === 0) {
      pendingCount++;
      continue;
    }

    try {
      let artist = '';
      let title = '';
      try {
        const meta = await extractMetadata(srcPath);
        artist = meta.artist;
        title = meta.title;
      } catch {
        // Fallback
      }

      if (!artist || !title) {
        const base = path.basename(decision.filename, path.extname(decision.filename));
        const parts = base.split(' - ');
        if (parts.length >= 2) {
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        } else {
          artist = 'Unknown Artist';
          title = base.trim();
        }
      }

      const metadata =
        decision.estimatedBpm || decision.estimatedKey
          ? { bpm: decision.estimatedBpm, key: decision.estimatedKey }
          : undefined;

      await routeFile(srcPath, targetCrates, metadata, sortedDir);
      routedCount++;
      useStore
        .getState()
        .addLog('ROUTED', `[Pocket] Routed ${decision.filename} -> /${targetCrates.join(' & /')}/`);

      examplesToAdd.push({ artist, title, folders: targetCrates });
    } catch (routeErr) {
      const msg = routeErr instanceof Error ? routeErr.message : String(routeErr);
      errors.push(`Failed to route ${decision.filename}: ${msg}`);
    }
  }

  // 3. RAG Cache Coherence
  if (examplesToAdd.length > 0) {
    invalidateCache();
    for (const ex of examplesToAdd) {
      addExample({
        artist: ex.artist,
        title: ex.title,
        folders: ex.folders,
        reasoning: 'Sorted via CrateMind Pocket',
        source: 'manual',
        ts: Date.now()
      });
    }
  }

  // 4. Telemetry and State Synchronization
  try {
    useStore.getState().setGlobalStats(getGlobalStats());
  } catch {
    // Ignore if DB offline
  }

  try {
    const remainingCount = fs.readdirSync(incomingDir).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
    }).length;
    useStore.getState().setIncomingCount(remainingCount);
  } catch {
    // Ignore
  }

  return {
    success: errors.length === 0,
    batchId: validatedPayload.batchId,
    processedCount,
    routedCount,
    skippedCount,
    pendingCount,
    unmodifiedCount: pendingCount,
    ragExamplesAdded: examplesToAdd.length,
    errors
  };
}
