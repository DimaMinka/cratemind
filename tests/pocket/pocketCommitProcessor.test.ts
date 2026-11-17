import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resetDBForTests } from '../../src/services/LocalDBService.js';
import * as RAGService from '../../src/services/RAGService.js';
import { useStore } from '../../src/services/UIService.js';
import { processCommit } from '../../src/services/pocket/pocketCommitProcessor.js';

describe('Tier 1 Unit: pocketCommitProcessor', () => {
  let tempDir: string;
  let incomingDir: string;
  let sortedDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cratemind-cp-test-'));
    incomingDir = path.join(tempDir, 'Incoming');
    sortedDir = path.join(tempDir, 'Sorted');
    fs.mkdirSync(incomingDir, { recursive: true });
    fs.mkdirSync(sortedDir, { recursive: true });
    process.env.CRATEMIND_DB_PATH = path.join(tempDir, 'test.db');
    resetDBForTests();

    // Ensure store is idle
    useStore.setState({
      isTelegramDownloading: false,
      isIndexingVibes: false,
      isLLMAnalyzing: false,
      driveSyncProgress: null
    });
  });

  afterEach(() => {
    resetDBForTests();
    delete process.env.CRATEMIND_DB_PATH;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on temp dir
    }
  });

  it('TC-CP-01: Path Traversal Rejection (..) throws error without touching filesystem', async () => {
    const payload = {
      batchId: 'batch-test-1',
      decisions: [
        {
          trackId: '1',
          filename: '../secret.mp3',
          status: 'tagged' as const,
          selectedFolders: ['club party']
        }
      ]
    };

    await expect(processCommit(payload, { incomingDir, sortedDir })).rejects.toThrow(/traversal/i);
  });

  it('TC-CP-02: Absolute Path Rejection throws error on leading slashes', async () => {
    const payload = {
      batchId: 'batch-test-2',
      decisions: [
        {
          trackId: '2',
          filename: '/etc/passwd.mp3',
          status: 'tagged' as const,
          selectedFolders: ['club party']
        }
      ]
    };

    await expect(processCommit(payload, { incomingDir, sortedDir })).rejects.toThrow();
  });

  it('TC-CP-03: Invalid Crate Folder Rejection rejects folders not in 21 FOLDERS', async () => {
    const file = path.join(incomingDir, 'track.mp3');
    fs.writeFileSync(file, 'AUDIO_DATA');

    const payload = {
      batchId: 'batch-test-3',
      decisions: [
        {
          trackId: '3',
          filename: 'track.mp3',
          status: 'tagged' as const,
          selectedFolders: ['non-existent-genre', 'invalid-crate']
        }
      ]
    };

    await expect(processCommit(payload, { incomingDir, sortedDir })).rejects.toThrow(
      /Invalid crate folder/i
    );
    expect(fs.existsSync(file)).toBe(true);
  });

  it('TC-CP-04: Safe Manual Override (Pending) leaves file untouched in Incoming', async () => {
    const file = path.join(incomingDir, 'PendingTrack.mp3');
    fs.writeFileSync(file, 'AUDIO_DATA');

    const payload = {
      batchId: 'batch-test-4',
      decisions: [
        {
          trackId: '4',
          filename: 'PendingTrack.mp3',
          status: 'pending' as const,
          selectedFolders: []
        }
      ]
    };

    const result = await processCommit(payload, { incomingDir, sortedDir });
    expect(result.unmodifiedCount).toBe(1);
    expect(result.routedCount).toBe(0);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('TC-CP-05: Safe Manual Override (Empty Tagged) leaves file untouched when no crates selected', async () => {
    const file = path.join(incomingDir, 'EmptySelection.mp3');
    fs.writeFileSync(file, 'AUDIO_DATA');

    const payload = {
      batchId: 'batch-test-5',
      decisions: [
        {
          trackId: '5',
          filename: 'EmptySelection.mp3',
          status: 'tagged' as const,
          selectedFolders: []
        }
      ]
    };

    const result = await processCommit(payload, { incomingDir, sortedDir });
    expect(result.unmodifiedCount).toBe(1);
    expect(result.routedCount).toBe(0);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('TC-CP-06: Explicit Skip Routing moves track to Sorted/skipped and unlinks from Incoming', async () => {
    const file = path.join(incomingDir, 'SkipMe.mp3');
    fs.writeFileSync(file, 'AUDIO_DATA');

    const payload = {
      batchId: 'batch-test-6',
      decisions: [
        {
          trackId: '6',
          filename: 'SkipMe.mp3',
          status: 'skipped' as const,
          selectedFolders: []
        }
      ]
    };

    const result = await processCommit(payload, { incomingDir, sortedDir });
    expect(result.skippedCount).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(sortedDir, 'skipped', 'SkipMe.mp3'))).toBe(true);
  });

  it('TC-CP-07: Single-Crate Routing copies file to target crate and removes from Incoming', async () => {
    const file = path.join(incomingDir, 'Tale Of Us - Astral.mp3');
    fs.writeFileSync(file, 'AUDIO_DATA');

    const payload = {
      batchId: 'batch-test-7',
      decisions: [
        {
          trackId: '7',
          filename: 'Tale Of Us - Astral.mp3',
          status: 'tagged' as const,
          selectedFolders: ['galaxy trip']
        }
      ]
    };

    const result = await processCommit(payload, { incomingDir, sortedDir });
    expect(result.routedCount).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(sortedDir, 'galaxy trip', 'Tale Of Us - Astral.mp3'))).toBe(
      true
    );
  });

  it('TC-CP-08: Multi-Crate Routing copies file to all selected folders', async () => {
    const file = path.join(incomingDir, 'MultiVibe.mp3');
    fs.writeFileSync(file, 'AUDIO_DATA');

    const payload = {
      batchId: 'batch-test-8',
      decisions: [
        {
          trackId: '8',
          filename: 'MultiVibe.mp3',
          status: 'tagged' as const,
          selectedFolders: ['magic forest', 'club party']
        }
      ]
    };

    const result = await processCommit(payload, { incomingDir, sortedDir });
    expect(result.routedCount).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(sortedDir, 'magic forest', 'MultiVibe.mp3'))).toBe(true);
    expect(fs.existsSync(path.join(sortedDir, 'club party', 'MultiVibe.mp3'))).toBe(true);
  });

  it('TC-CP-09: RAG Cache Invalidation Coherence updates rag_examples with manual source', async () => {
    const file = path.join(incomingDir, 'Bicep - Glue.mp3');
    fs.writeFileSync(file, 'AUDIO_DATA');

    const payload = {
      batchId: 'batch-test-9',
      decisions: [
        {
          trackId: '9',
          filename: 'Bicep - Glue.mp3',
          status: 'tagged' as const,
          selectedFolders: ['club party']
        }
      ]
    };

    const result = await processCommit(payload, { incomingDir, sortedDir });
    expect(result.ragExamplesAdded).toBe(1);

    const found = RAGService.findExample('Bicep', 'Glue');
    expect(found).not.toBeNull();
    expect(found?.folders).toContain('club party');
    expect(found?.source).toBe('manual');
  });

  it('TC-CP-10: Isolation: Live DB and directories are untouched during test run', async () => {
    expect(process.env.CRATEMIND_DB_PATH).toContain('cratemind-cp-test-');

    const prodDbExists = fs.existsSync(path.resolve('cratemind.db'));
    let initialMtime = 0;
    if (prodDbExists) {
      initialMtime = fs.statSync(path.resolve('cratemind.db')).mtimeMs;
    }

    const file = path.join(incomingDir, 'IsolationTrack.mp3');
    fs.writeFileSync(file, 'AUDIO_DATA');

    await processCommit(
      {
        batchId: 'batch-isolation',
        decisions: [
          {
            trackId: 'iso-1',
            filename: 'IsolationTrack.mp3',
            status: 'tagged' as const,
            selectedFolders: ['mountain sunset']
          }
        ]
      },
      { incomingDir, sortedDir }
    );

    if (prodDbExists) {
      const finalMtime = fs.statSync(path.resolve('cratemind.db')).mtimeMs;
      expect(finalMtime).toBe(initialMtime);
    }
  });

  it('TC-CP-11: Partial Failure Handling records missing files in errors without throwing', async () => {
    const validFile = path.join(incomingDir, 'ValidTrack.mp3');
    fs.writeFileSync(validFile, 'AUDIO_DATA');

    const payload = {
      batchId: 'batch-partial',
      decisions: [
        {
          trackId: '1',
          filename: 'MissingTrack.mp3', // missing on disk
          status: 'tagged' as const,
          selectedFolders: ['club party']
        },
        {
          trackId: '2',
          filename: 'ValidTrack.mp3',
          status: 'tagged' as const,
          selectedFolders: ['club party']
        }
      ]
    };

    const result = await processCommit(payload, { incomingDir, sortedDir });
    expect(result.success).toBe(false);
    expect(result.processedCount).toBe(2);
    expect(result.routedCount).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('MissingTrack.mp3');
  });

  it('TC-CP-12: Empty Decisions Array completes cleanly with 0 processed items', async () => {
    const payload = {
      batchId: 'batch-empty',
      decisions: []
    };

    const result = await processCommit(payload, { incomingDir, sortedDir });
    expect(result.success).toBe(true);
    expect(result.processedCount).toBe(0);
    expect(result.routedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.unmodifiedCount).toBe(0);
  });

  it('TC-CP-13: Dot and Directory Filename Rejection rejects dot-only filenames as path traversal', async () => {
    const payloadDot = {
      batchId: 'batch-dot',
      decisions: [
        {
          filename: '.',
          status: 'skipped' as const,
          selectedFolders: []
        }
      ]
    };
    await expect(processCommit(payloadDot, { incomingDir, sortedDir })).rejects.toThrow(
      /traversal/i
    );
  });
});
