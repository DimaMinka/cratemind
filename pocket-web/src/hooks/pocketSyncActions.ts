import type {
  PocketBatchManifest,
  PocketCommitResult,
  PocketDecision,
  PocketTrackItem
} from '../types/pocketWeb.types.js';
import type { PocketStoreState } from './pocketStore.types.js';
import {
  clearBatch,
  deleteAudioBlob,
  getTotalCachedAudioSize,
  requestPersistentStorage,
  saveAudioBlob,
  saveBatchManifest
} from '../engine/indexedDbStore.js';

type StoreSet = (partial: Partial<PocketStoreState>) => void;
type StoreGet = () => PocketStoreState;

const AUDIO_PREFETCH_CONCURRENCY = 4;

async function cacheTrackAudioBlobs(tracks: PocketTrackItem[]): Promise<void> {
  if (tracks.length === 0 || typeof fetch !== 'function') return;

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(AUDIO_PREFETCH_CONCURRENCY, tracks.length) },
    async () => {
      while (cursor < tracks.length) {
        const idx = cursor++;
        const track = tracks[idx];
        const url = track.previewAudioUrl || `/api/audio/${encodeURIComponent(track.id)}`;
        try {
          const audioResp = await fetch(url);
          if (audioResp.ok) {
            const blob = await audioResp.blob();
            if (blob && blob.size > 0) {
              await saveAudioBlob(track.id, blob);
            }
          }
        } catch {
          // Continue caching remaining tracks even if one preview fails
        }
      }
    }
  );

  await Promise.all(workers);
}

export async function checkBridgeHealthAction(set: StoreSet): Promise<boolean> {
  if (typeof fetch !== 'function') return false;
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 2500) : null;
    try {
      const response = await fetch('/api/health', {
        signal: controller?.signal
      });
      if (response.ok) {
        set({ isBridgeConnected: true });
        return true;
      }
      set({ isBridgeConnected: false });
      return false;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch {
    set({ isBridgeConnected: false });
    return false;
  }
}

export async function pullBatchFromMacAction(
  set: StoreSet,
  getOrLimit?: StoreGet | number,
  limitParam = 30,
  appendParam = true
): Promise<boolean> {
  let get: StoreGet | undefined;
  let limit = 30;
  let append = true;

  if (typeof getOrLimit === 'function') {
    get = getOrLimit;
    limit = limitParam;
    append = appendParam;
  } else if (typeof getOrLimit === 'number') {
    limit = getOrLimit;
    append = false;
  }

  set({ isSyncing: true, syncError: null });
  try {
    const currentTracks = get ? get().tracks : [];
    let url = `/api/batch?limit=${limit}`;

    // If append mode is active and we already have tracks, exclude them so we get new tracks
    if (append && currentTracks.length > 0) {
      const existingFilenames = currentTracks.map((t) => t.filename).join(',');
      url += `&exclude=${encodeURIComponent(existingFilenames)}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch batch: HTTP ${response.status}`);
    }
    const manifest: PocketBatchManifest = await response.json();

    if (!append || currentTracks.length === 0) {
      // Clear prior batch decisions & blobs before persisting brand new batch
      await clearBatch();
      await saveBatchManifest(manifest);
      await cacheTrackAudioBlobs(manifest.tracks);

      const cachedBytes = await getTotalCachedAudioSize();
      const storageQuota = await requestPersistentStorage();

      const decisionsMap: Record<string, PocketDecision> = {};
      for (const t of manifest.tracks) {
        decisionsMap[t.id] = {
          trackId: t.id,
          filename: t.filename,
          status: 'pending',
          selectedFolders: [],
          decisionTimestamp: Date.now()
        };
      }

      set({
        manifest,
        tracks: manifest.tracks,
        activeTrackIndex: 0,
        decisions: decisionsMap,
        selectedFolders: [],
        cachedAudioSize: cachedBytes,
        storageQuota,
        isSyncing: false,
        isBridgeConnected: true
      });
      return true;
    }

    // Append mode: merge new tracks into existing batch
    const currentDecisions = get ? get().decisions : {};
    const existingIds = new Set(currentTracks.map((t) => t.id));
    const newTracks = manifest.tracks.filter((t) => !existingIds.has(t.id));

    if (newTracks.length === 0) {
      set({
        isSyncing: false,
        isBridgeConnected: true
      });
      return true;
    }

    const mergedTracks = [...currentTracks, ...newTracks];
    const mergedManifest: PocketBatchManifest = {
      ...(get ? get().manifest : manifest)!,
      totalTracks: mergedTracks.length,
      tracks: mergedTracks
    };

    await saveBatchManifest(mergedManifest);
    await cacheTrackAudioBlobs(newTracks);

    const cachedBytes = await getTotalCachedAudioSize();
    const storageQuota = await requestPersistentStorage();

    const updatedDecisions = { ...currentDecisions };
    for (const t of newTracks) {
      if (!updatedDecisions[t.id]) {
        updatedDecisions[t.id] = {
          trackId: t.id,
          filename: t.filename,
          status: 'pending',
          selectedFolders: [],
          decisionTimestamp: Date.now()
        };
      }
    }

    set({
      manifest: mergedManifest,
      tracks: mergedTracks,
      decisions: updatedDecisions,
      cachedAudioSize: cachedBytes,
      storageQuota,
      isSyncing: false,
      isBridgeConnected: true
    });
    return true;
  } catch (err) {
    set({
      isSyncing: false,
      syncError: err instanceof Error ? err.message : 'Connection failed'
    });
    return false;
  }
}

export async function commitToMacAction(set: StoreSet, get: StoreGet): Promise<boolean> {
  const { manifest, tracks, decisions, activeTrackIndex } = get();
  set({ isSyncing: true, syncError: null });
  try {
    const activeDecisions =
      tracks.length > 0
        ? tracks.map((t) => decisions[t.id]).filter((d): d is PocketDecision => Boolean(d))
        : Object.values(decisions);

    const payload = {
      batchId: manifest?.batchId || 'batch-01',
      decisions: activeDecisions
    };
    const response = await fetch('/api/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.status === 409) {
      throw new Error('Mac is busy with another background task (Telegram download / indexing).');
    }
    if (!response.ok) {
      throw new Error(`Commit failed: HTTP ${response.status}`);
    }

    let result: PocketCommitResult | null = null;
    try {
      result = (await response.json()) as PocketCommitResult;
    } catch {
      result = null;
    }

    const errorMessages = result?.errors ?? [];
    const remainingTracks: PocketTrackItem[] = [];
    const remainingDecisions: Record<string, PocketDecision> = {};

    for (const track of tracks) {
      const dec = decisions[track.id];
      const isActionable = dec && (dec.status === 'tagged' || dec.status === 'skipped');
      const hadError = errorMessages.some((msg) => msg.includes(track.filename));

      if (isActionable && !hadError) {
        await deleteAudioBlob(track.id).catch(() => {});
      } else {
        remainingTracks.push(track);
        if (dec) {
          remainingDecisions[track.id] = dec;
        }
      }
    }

    if (remainingTracks.length === 0) {
      await clearBatch().catch(() => {});
      set({
        manifest: manifest ? { ...manifest, totalTracks: 0, tracks: [] } : null,
        tracks: [],
        decisions: {},
        activeTrackIndex: 0,
        selectedFolders: [],
        cachedAudioSize: 0,
        isSyncing: false,
        syncError: null,
        isBridgeConnected: true
      });
    } else {
      const updatedManifest: PocketBatchManifest = {
        batchId: manifest?.batchId || 'batch-01',
        createdAt: manifest?.createdAt,
        generatedAt: manifest?.generatedAt,
        mode: manifest?.mode,
        ragExamplesCount: manifest?.ragExamplesCount,
        ragTotalExamples: manifest?.ragTotalExamples,
        totalTracks: remainingTracks.length,
        tracks: remainingTracks
      };
      await saveBatchManifest(updatedManifest).catch(() => {});
      const cachedBytes = await getTotalCachedAudioSize().catch(() => 0);
      set({
        manifest: updatedManifest,
        tracks: remainingTracks,
        decisions: remainingDecisions,
        activeTrackIndex: Math.min(activeTrackIndex, remainingTracks.length - 1),
        selectedFolders: [],
        cachedAudioSize: cachedBytes,
        isSyncing: false,
        syncError: null,
        isBridgeConnected: true
      });
    }

    return true;
  } catch (err) {
    set({
      isSyncing: false,
      syncError: err instanceof Error ? err.message : 'Commit failed'
    });
    return false;
  }
}

export async function importLocalFilesAction(set: StoreSet, files: File[]): Promise<void> {
  const audioFiles = files.filter((f) => /\.(mp3|wav|flac|aiff|m4a|aac|ogg)$/i.test(f.name));
  if (audioFiles.length === 0) return;

  const now = Date.now();
  const importedTracks: PocketTrackItem[] = audioFiles.map((file, idx) => ({
    id: `local-${now}-${idx}`,
    filename: file.name,
    title: file.name.replace(/\.[^/.]+$/, ''),
    artist: 'Local Import',
    duration: 180,
    mode: 'raw-manual',
    status: 'pending'
  }));

  const manifest: PocketBatchManifest = {
    batchId: `local-batch-${now}`,
    generatedAt: now,
    mode: 'raw-manual',
    totalTracks: importedTracks.length,
    tracks: importedTracks
  };

  await clearBatch();
  await saveBatchManifest(manifest);
  const decisionsMap: Record<string, PocketDecision> = {};
  for (let i = 0; i < audioFiles.length; i++) {
    await saveAudioBlob(importedTracks[i].id, audioFiles[i]);
    decisionsMap[importedTracks[i].id] = {
      trackId: importedTracks[i].id,
      filename: importedTracks[i].filename,
      status: 'pending',
      selectedFolders: [],
      decisionTimestamp: now
    };
  }

  const cachedBytes = await getTotalCachedAudioSize();
  const storageQuota = await requestPersistentStorage();
  set({
    manifest,
    tracks: importedTracks,
    decisions: decisionsMap,
    activeTrackIndex: 0,
    selectedFolders: [],
    cachedAudioSize: cachedBytes,
    storageQuota
  });
}
