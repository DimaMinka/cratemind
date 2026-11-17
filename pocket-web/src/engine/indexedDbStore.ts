import { openDB, type IDBPDatabase } from 'idb';
import type {
  PocketBatchManifest,
  PocketDecision,
  PocketTrackItem
} from '../types/pocketWeb.types.js';

const DEFAULT_DB_NAME = 'cratemind_pocket_db';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;
let currentDbName = DEFAULT_DB_NAME;

export async function initIndexedDbStore(dbName = DEFAULT_DB_NAME): Promise<IDBPDatabase> {
  if (dbPromise && currentDbName !== dbName) {
    try {
      const existing = await dbPromise;
      existing.close();
    } catch {
      // Ignore error closing failed previous openDB handle
    }
    dbPromise = null;
  }

  currentDbName = dbName;
  if (!dbPromise) {
    dbPromise = openDB(dbName, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('manifest')) {
          db.createObjectStore('manifest');
        }
        if (!db.objectStoreNames.contains('audio_blobs')) {
          db.createObjectStore('audio_blobs');
        }
        if (!db.objectStoreNames.contains('decisions')) {
          db.createObjectStore('decisions', { keyPath: 'trackId' });
        }
        if (!db.objectStoreNames.contains('pending_mutations')) {
          db.createObjectStore('pending_mutations', { keyPath: 'id' });
        }
      }
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }

  return dbPromise;
}

export async function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    return initIndexedDbStore(currentDbName);
  }
  return dbPromise;
}

export async function saveBatchManifest(manifest: PocketBatchManifest): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['manifest', 'decisions'], 'readwrite');
  try {
    await tx.objectStore('manifest').put(manifest, 'current_manifest');

    const decisionStore = tx.objectStore('decisions');
    const activeTrackIds = new Set(manifest.tracks.map((t) => t.id));
    const existingDecisions = (await decisionStore.getAll()) as PocketDecision[];
    for (const existing of existingDecisions) {
      if (!activeTrackIds.has(existing.trackId)) {
        await decisionStore.delete(existing.trackId);
      }
    }

    for (const track of manifest.tracks) {
      const existing = await decisionStore.get(track.id);
      if (!existing) {
        await decisionStore.put({
          trackId: track.id,
          filename: track.filename,
          status: 'pending',
          selectedFolders: track.selectedFolders || [],
          decisionTimestamp: Date.now()
        } satisfies PocketDecision);
      }
    }
    await tx.done;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // Ignore if transaction already finished or aborted
    }
    await tx.done.catch(() => {});
    throw err;
  }
}

export async function getBatchManifest(): Promise<PocketBatchManifest | null> {
  const db = await getDb();
  const manifest = await db.get('manifest', 'current_manifest');
  return (manifest as PocketBatchManifest) || null;
}

export async function saveAudioBlob(trackId: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put('audio_blobs', blob, trackId);
}

export async function getAudioBlob(trackId: string): Promise<Blob | null> {
  const db = await getDb();
  const blob = await db.get('audio_blobs', trackId);
  return (blob as Blob) || null;
}

export async function deleteAudioBlob(trackId: string): Promise<void> {
  const db = await getDb();
  await db.delete('audio_blobs', trackId);
}

export async function getTotalCachedAudioSize(): Promise<number> {
  const db = await getDb();
  const tx = db.transaction('audio_blobs', 'readonly');
  const store = tx.objectStore('audio_blobs');
  let totalBytes = 0;
  let cursor = await store.openCursor();
  while (cursor) {
    const blob = cursor.value as Blob;
    if (blob && typeof blob.size === 'number') {
      totalBytes += blob.size;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return totalBytes;
}

export async function saveDecision(decision: PocketDecision): Promise<void> {
  const db = await getDb();
  await db.put('decisions', decision);
}

export async function getDecision(trackId: string): Promise<PocketDecision | null> {
  const db = await getDb();
  const decision = await db.get('decisions', trackId);
  return (decision as PocketDecision) || null;
}

export async function getAllDecisions(): Promise<PocketDecision[]> {
  const db = await getDb();
  return (await db.getAll('decisions')) as PocketDecision[];
}

export async function getFilteredTracks(
  filter: 'all' | 'pending' | 'tagged' | 'skipped'
): Promise<PocketTrackItem[]> {
  const db = await getDb();
  const tx = db.transaction(['manifest', 'decisions'], 'readonly');
  const manifest = (await tx.objectStore('manifest').get('current_manifest')) as
    | PocketBatchManifest
    | undefined;
  if (!manifest || !manifest.tracks) {
    await tx.done;
    return [];
  }

  const decisions = (await tx.objectStore('decisions').getAll()) as PocketDecision[];
  await tx.done;

  const decisionMap = new Map<string, PocketDecision>();
  for (const d of decisions) {
    decisionMap.set(d.trackId, d);
  }

  return manifest.tracks.filter((track) => {
    const dec = decisionMap.get(track.id);
    const status = dec?.status || 'pending';
    if (filter === 'all') return true;
    return status === filter;
  });
}

export async function requestPersistentStorage(): Promise<{
  persisted: boolean;
  quota: number;
  usage: number;
}> {
  let persisted = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      persisted = await navigator.storage.persist();
    }
  } catch {
    persisted = false;
  }

  let quota = 0;
  let usage = 0;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      quota = estimate.quota || 0;
      usage = estimate.usage || 0;
    }
  } catch {
    quota = 0;
    usage = 0;
  }

  return { persisted, quota, usage };
}

export async function exportDecisionsAsJson(): Promise<string> {
  const db = await getDb();
  const tx = db.transaction(['manifest', 'decisions'], 'readonly');
  const manifest = (await tx.objectStore('manifest').get('current_manifest')) as
    | PocketBatchManifest
    | undefined;
  const allDecisions = (await tx.objectStore('decisions').getAll()) as PocketDecision[];
  await tx.done;

  const activeDecisions = manifest?.tracks
    ? allDecisions.filter((d) => manifest.tracks.some((t) => t.id === d.trackId))
    : allDecisions;

  const payload = {
    batchId: manifest?.batchId || 'unknown_batch',
    exportedAt: Date.now(),
    totalTracks: manifest?.totalTracks ?? activeDecisions.length,
    decisions: activeDecisions
  };

  return JSON.stringify(payload, null, 2);
}

export interface PocketPendingMutation {
  id: string;
  trackId: string;
  decision: unknown;
  createdAt: number;
}

export async function enqueueMutation(mutation: PocketPendingMutation): Promise<void> {
  const db = await getDb();
  await db.put('pending_mutations', mutation);
}

export async function getPendingMutations(): Promise<PocketPendingMutation[]> {
  const db = await getDb();
  return (await db.getAll('pending_mutations')) as PocketPendingMutation[];
}

export async function clearPendingMutations(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('pending_mutations', 'readwrite');
  for (const id of ids) {
    await tx.objectStore('pending_mutations').delete(id);
  }
  await tx.done;
}

export async function clearBatch(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['manifest', 'audio_blobs', 'decisions'], 'readwrite');
  await tx.objectStore('manifest').clear();
  await tx.objectStore('audio_blobs').clear();
  await tx.objectStore('decisions').clear();
  await tx.done;
}

export async function closeIndexedDb(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // Ignore failed open promise
    }
    dbPromise = null;
  }
}
