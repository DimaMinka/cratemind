import { z } from 'zod';
import * as path from 'node:path';
import { FOLDERS } from '../../config.js';

/**
 * pocketTypes.ts
 *
 * Domain types, interfaces, and Zod runtime validation schemas
 * for CrateMind Pocket bridge service and iOS PWA communication.
 */

// ── Valid Folder Targets ──────────────────────────────────────────────────────
export const POCKET_VALID_FOLDERS = [...FOLDERS, 'skipped'] as const;
export type PocketValidFolder = (typeof POCKET_VALID_FOLDERS)[number];

// ── Zod Schemas ──────────────────────────────────────────────────────────────
export const pocketDecisionSchema = z.object({
  id: z.string().optional(),
  trackId: z.string().optional(),
  filename: z
    .string()
    .min(1)
    .refine(
      (name) => {
        const trimmed = name.trim();
        if (trimmed === '.' || trimmed === '..' || /^[.\s/\\]+$/.test(name)) return false;
        return (
          !name.includes('..') &&
          !name.includes('/') &&
          !name.includes('\\') &&
          !name.includes('\0') &&
          name !== '.' &&
          path.basename(name) === name
        );
      },
      { message: 'Path traversal attempt detected in filename' }
    ),
  status: z.enum(['tagged', 'skipped', 'pending']),
  selectedFolders: z
    .array(z.string())
    .refine(
      (folders) => folders.every((f) => (POCKET_VALID_FOLDERS as readonly string[]).includes(f)),
      { message: 'Invalid crate folder name' }
    ),
  estimatedBpm: z.number().optional(),
  estimatedKey: z.string().optional(),
  updatedAt: z.number().optional()
});

export const pocketCommitPayloadSchema = z.object({
  batchId: z.string().min(1),
  decisions: z.array(pocketDecisionSchema)
});

// ── Inferred Types ───────────────────────────────────────────────────────────
export type PocketDecision = z.infer<typeof pocketDecisionSchema>;
export type PocketCommitPayload = z.infer<typeof pocketCommitPayloadSchema>;

// ── Domain & API Interfaces ──────────────────────────────────────────────────
export interface PocketAcousticProfile {
  bpm: number | null;
  key: string | null;
  energyShape: number[] | null; // 16 normalized values (0..100)
  subBassPercent?: number | null;
  midPercent?: number | null;
  highPercent?: number | null;
  onsetPercent?: number | null;
}

export interface PocketSpectralProfile {
  subBassDb: number | null;
  bassDb: number | null;
  midDb: number | null;
  highDb: number | null;
  onsetDensity: number | null;
}

export interface PocketRagSuggestion {
  folder: string | null;
  confidence: number; // 0-100 percentage
  matchType: 'exact' | 'artist' | 'clap_embedding' | 'acoustic' | 'none';
  referenceTrack?: string;
  neighbors: Array<{
    artist: string;
    title: string;
    folder: string;
    similarity: number;
  }>;
}

export interface PocketYouTubeNeighbor {
  index: number;
  artist: string;
  title: string;
  folder: string | null;
}

export interface PocketYouTubeScout {
  hasMatch: boolean;
  playlistId: string | null;
  playlistTitle: string | null;
  trackIndex: number | null;
  matchedFolder: string | null;
  neighbors: PocketYouTubeNeighbor[];
}

export interface PocketTrackItem {
  id: string; // URL-safe base64url encoded filename
  filename: string;
  filepath: string; // relative to Incoming/
  artist: string;
  title: string;
  duration: number; // seconds
  durationFormatted?: string; // "MM:SS"
  bpm?: number | null;
  key?: string | null;
  fileSizeBytes: number;
  previewAudioUrl?: string; // "/api/audio/:id"
  mode?: 'pre-analyzed' | 'raw-manual';
  status: 'pending' | 'tagged' | 'skipped';
  selectedFolders: string[];
  acoustic?: PocketAcousticProfile;
  energyShape?: number[] | null;
  spectralProfile?: PocketSpectralProfile | null;
  ragSuggestion: PocketRagSuggestion;
  ytScout: PocketYouTubeScout;
}

export interface PocketBatchManifest {
  batchId: string;
  createdAt: number;
  generatedAt?: number;
  mode: 'pre-analyzed' | 'raw-manual';
  totalTracks: number;
  totalSizeMb?: number;
  ragExamplesCount?: number;
  ragTotalExamples?: number;
  tracks: PocketTrackItem[];
}

export interface PocketCommitResult {
  success: boolean;
  batchId: string;
  processedCount: number;
  routedCount: number;
  skippedCount: number;
  pendingCount: number;
  unmodifiedCount?: number; // alias for pendingCount (tracks untouched in Incoming/)
  ragExamplesAdded?: number;
  errors: string[];
}

export interface PocketHealthStatus {
  status: 'ok' | 'busy';
  uptime?: number;
  incomingCount: number;
  ragCount: number;
  isBusy: boolean;
  activeTask: string | null;
}
