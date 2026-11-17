import * as fs from 'node:fs';
import * as path from 'node:path';
import { INCOMING_DIR, AUDIO_EXTENSIONS } from '../../config.js';
import { extractMetadata } from '../ID3Service.js';
import {
  isAvailable as isVibesAvailable,
  getAllAnalyzedIncomingTracks
} from '../VibesDBService.js';
import {
  findLocalRagMatch,
  findYouTubeScoutMatch,
  getRagTotalExamples
} from './pocketDbQueries.js';
import {
  PocketBatchManifest,
  PocketTrackItem,
  PocketAcousticProfile,
  PocketSpectralProfile
} from './pocketTypes.js';

export interface BuildManifestOptions {
  incomingDir?: string;
  sortedDir?: string;
  limit?: number;
  excludeFilenames?: string[];
}

/**
 * Builds a batch manifest of incoming audio tracks enriched with local intelligence.
 * Strictly offline: zero external AI/LLM network calls.
 */
export async function buildBatchManifest(
  options?: BuildManifestOptions
): Promise<PocketBatchManifest> {
  const incomingDir = options?.incomingDir ?? path.resolve(INCOMING_DIR);
  const requestedLimit = options?.limit ?? 30;
  const limit = Math.max(1, Math.min(requestedLimit, 30));
  const excludedSet = new Set(options?.excludeFilenames ?? []);
  const now = Date.now();
  const batchId = `batch-${now}`;
  const ragCount = getRagTotalExamples();

  if (!fs.existsSync(incomingDir)) {
    return {
      batchId,
      createdAt: now,
      generatedAt: now,
      mode: 'raw-manual',
      totalTracks: 0,
      totalSizeMb: 0,
      ragExamplesCount: ragCount,
      ragTotalExamples: ragCount,
      tracks: []
    };
  }

  let entries: string[];
  try {
    entries = await fs.promises.readdir(incomingDir);
  } catch {
    entries = [];
  }

  const audioFiles = entries.filter((file) => {
    if (excludedSet.has(file)) return false;
    const ext = path.extname(file).toLowerCase();
    return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
  });

  audioFiles.sort((a, b) => a.localeCompare(b));
  const selectedFiles = audioFiles.slice(0, limit);

  if (selectedFiles.length === 0) {
    return {
      batchId,
      createdAt: now,
      generatedAt: now,
      mode: 'raw-manual',
      totalTracks: 0,
      totalSizeMb: 0,
      ragExamplesCount: ragCount,
      ragTotalExamples: ragCount,
      tracks: []
    };
  }

  let vibesMap = new Map();
  if (isVibesAvailable()) {
    try {
      vibesMap = getAllAnalyzedIncomingTracks(incomingDir);
    } catch {
      // Graceful fallback if Vibes DB read fails
    }
  }

  const tracks: PocketTrackItem[] = [];
  let preAnalyzedCount = 0;
  let totalBytes = 0;

  for (const filename of selectedFiles) {
    const filepath = path.join(incomingDir, filename);
    const fullPath = path.resolve(filepath);

    let fileSizeBytes: number;
    try {
      const stats = fs.statSync(filepath);
      fileSizeBytes = stats.size;
    } catch {
      fileSizeBytes = 0;
    }
    totalBytes += fileSizeBytes;

    const id = Buffer.from(filename, 'utf-8').toString('base64url');
    const vibesData = vibesMap.get(fullPath) ?? vibesMap.get(filename) ?? null;

    let artist = '';
    let title = '';
    let duration = 180;
    let bpm: number | null = null;
    let key: string | null = null;

    try {
      const id3 = await extractMetadata(filepath);
      artist = id3.artist;
      title = id3.title;
      duration = id3.duration;
      if (id3.bpm) bpm = id3.bpm;
      if (id3.key) key = id3.key;
    } catch {
      // Fallback
    }

    if (vibesData?.track.artist && vibesData.track.artist.toLowerCase() !== 'unknown') {
      artist = vibesData.track.artist;
    }
    if (vibesData?.track.title && vibesData.track.title.toLowerCase() !== 'unknown') {
      title = vibesData.track.title;
    }
    if (vibesData?.track.bpm) bpm = vibesData.track.bpm;
    if (vibesData?.track.key) key = vibesData.track.key;
    if (vibesData?.track.duration) duration = vibesData.track.duration;

    if (!artist || !title) {
      const base = path.basename(filename, path.extname(filename));
      const parts = base.split(' - ');
      if (parts.length >= 2) {
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      } else {
        artist = 'Unknown Artist';
        title = base.trim();
      }
    }

    let energyShape: number[] | null = null;
    let spectralProfile: PocketSpectralProfile | null = null;

    if (vibesData?.soundProfile?.energyShape && vibesData.soundProfile.energyShape.length > 0) {
      energyShape = vibesData.soundProfile.energyShape;
    }

    if (vibesData?.track.vibeFeatures) {
      const vf = vibesData.track.vibeFeatures;
      spectralProfile = {
        subBassDb:
          vf.band_sub_bass_mean !== undefined ? Math.round(vf.band_sub_bass_mean * 10) / 10 : null,
        bassDb: vf.band_bass_mean !== undefined ? Math.round(vf.band_bass_mean * 10) / 10 : null,
        midDb: vf.band_mid_mean !== undefined ? Math.round(vf.band_mid_mean * 10) / 10 : null,
        highDb: vf.band_high_mean !== undefined ? Math.round(vf.band_high_mean * 10) / 10 : null,
        onsetDensity: vf.onset_density !== undefined ? Math.round(vf.onset_density * 10) / 10 : null
      };
    }

    const clapEmbedding = vibesData?.track.clapEmbedding ?? null;
    const ragSuggestion = findLocalRagMatch(artist, title, clapEmbedding, bpm, key);
    const ytScout = findYouTubeScoutMatch(artist, title);

    const hasAcoustic = Boolean(bpm || energyShape || spectralProfile);
    const hasHints = Boolean(ragSuggestion.folder || ytScout.hasMatch);
    if (hasAcoustic || hasHints) {
      preAnalyzedCount++;
    }

    const acoustic: PocketAcousticProfile = {
      bpm,
      key,
      energyShape
    };

    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    const durationFormatted = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

    tracks.push({
      id,
      filename,
      filepath: path.relative(incomingDir, filepath),
      artist,
      title,
      duration,
      durationFormatted,
      bpm,
      key,
      fileSizeBytes,
      previewAudioUrl: `/api/audio/${id}`,
      mode: hasAcoustic || hasHints ? 'pre-analyzed' : 'raw-manual',
      status: 'pending',
      selectedFolders: [],
      acoustic,
      energyShape,
      spectralProfile,
      ragSuggestion,
      ytScout
    });
  }

  const batchMode: 'pre-analyzed' | 'raw-manual' =
    tracks.length > 0 && preAnalyzedCount >= Math.ceil(tracks.length / 2)
      ? 'pre-analyzed'
      : 'raw-manual';

  const totalSizeMb = Math.round((totalBytes / (1024 * 1024)) * 100) / 100;

  return {
    batchId,
    createdAt: now,
    generatedAt: now,
    mode: batchMode,
    totalTracks: tracks.length,
    totalSizeMb,
    ragExamplesCount: ragCount,
    ragTotalExamples: ragCount,
    tracks
  };
}
