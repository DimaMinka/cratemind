import * as path from 'path';
import * as fs from 'fs';
import { useStore } from './UIService.js';
import * as RAGService from './RAGService.js';
import * as LLMService from './LLMService.js';
import { extractMetadata } from './ID3Service.js';
import { routeFile } from './RoutingService.js';
import * as CacheService from './CacheService.js';
import * as UserInteractionService from './UserInteractionService.js';
import * as NetworkScoutService from './NetworkScoutService.js';
import * as EngineDBService from './EngineDBService.js';
import * as EmbeddingService from './EmbeddingService.js';
import * as VibesDBService from './VibesDBService.js';
import { buildPassport, buildPassportSummary } from './TrackPassportService.js';
import { logToFile } from './LoggerService.js';
import {
  YT_SCOUT_ENABLED,
  CONFIDENCE_THRESHOLD,
  FOLDERS,
  INCOMING_DIR,
  AUDIO_EXTENSIONS,
  FORCE_MANUAL_MODE,
  BATCH_SIZE
} from '../config.js';
import {
  LLMResponse,
  VectorNeighbor,
  TrackMeta,
  NetworkScoutResult,
  VibesIntelligence
} from '../types.js';
import { SpotifyAudioFeatures } from './SpotifyService.js';
import { getGlobalStats, saveTrackIntelligence } from './LocalDBService.js';

/**
 * TrackProcessor.ts
 *
 * Business orchestrator: declarative linear pipeline for processing
 * a single audio track from ID3 extraction through to final routing.
 *
 * Pipeline steps:
 * 1. ID3 metadata extraction
 * 2. RAG memory lookup (instant route on hit)
 * 3. YouTube Network Scout (playlist context + neighbor tracks)
 * 4. LLM classification via Gemini (enriched with YouTube context)
 * 5. User interaction (ManualOverride)
 * 6. File routing to vibe crates
 * 7. RAG memory update
 *
 * Extracted from FSService to separate business logic from
 * infrastructure concerns (chokidar, PQueue).
 */

export async function processTrack(filepath: string): Promise<void> {
  return processTracksBatch([filepath]);
}

interface TrackBatchState {
  filepath: string;
  filename: string;
  meta: TrackMeta;
  spotifyFeatures: SpotifyAudioFeatures | null;
  spotifyProfile: string;
  vibesData: VibesIntelligence | null;
  vibesProfile: string;
  physicalProfile: string;
  ragContext: string;
  personalHints: string;
  networkContext: string;
  contextHash: string;
  vectorNeighbors: VectorNeighbor[];
  scoutResult: NetworkScoutResult | null;
  ragHit: boolean;
  cacheHit: boolean;
  llmResponse?: LLMResponse;
  limitExceeded?: boolean;
  missingApiKey?: boolean;
  networkError?: boolean;
  schemaError?: boolean;
  errorMsg?: string;
  bypassed?: boolean;
  passportSummary?: string;
  passportSummaryForPlayer?: string;
}

export async function processTracksBatch(filepaths: string[]): Promise<void> {
  const addLog = useStore.getState().addLog;

  if (filepaths.length === 0) return;

  const isDownloadOnly = useStore.getState().telegramDownloadOnly;
  if (isDownloadOnly) {
    addLog(
      'SYSTEM',
      `Download-only mode is active. Skipping analysis for ${filepaths.length} track(s).`
    );
    return;
  }

  const filepathChunks: string[][] = [];
  for (let i = 0; i < filepaths.length; i += BATCH_SIZE) {
    filepathChunks.push(filepaths.slice(i, i + BATCH_SIZE));
  }

  for (let chunkIdx = 0; chunkIdx < filepathChunks.length; chunkIdx++) {
    const chunkFilepaths = filepathChunks[chunkIdx];
    if (filepathChunks.length > 1) {
      addLog(
        'SYSTEM',
        `Starting incoming batch ${chunkIdx + 1}/${filepathChunks.length} (${chunkFilepaths.length} tracks)...`
      );
    }
    await processSingleFilepathChunk(chunkFilepaths);
  }
}

async function processSingleFilepathChunk(filepaths: string[]): Promise<void> {
  const addLog = useStore.getState().addLog;
  const incrementStat = useStore.getState().incrementStat;
  const states: TrackBatchState[] = [];

  // Preload Vibes.app acoustic and semantic intelligence in batch for zero latency
  const vibesMap = VibesDBService.getAllAnalyzedIncomingTracks(INCOMING_DIR);

  // Step 1: Metadata Extraction & Local RAG/Cache Checking
  for (const filepath of filepaths) {
    try {
      const filename = path.basename(filepath);
      addLog('DETECTED', `Discovered track: ${filename}`);

      if (fs.existsSync(filepath)) {
        const stats = fs.statSync(filepath);
        const ext = path.extname(filepath).toLowerCase();

        let minSize = 1024 * 1024; // 1MB default for compressed formats (mp3, m4a, ogg)
        if (['.flac', '.wav', '.aiff'].includes(ext)) {
          minSize = 1024 * 1024 * 2; // 2MB for lossless formats (flac, wav, aiff)
        }

        if (stats.size < minSize) {
          addLog(
            'SYSTEM',
            `Ignoring empty/corrupt track: ${filename} (size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB)`
          );
          await routeFile(filepath, ['skipped']);
          incrementStat('processed');
          const currentStats = CacheService.getStats();
          useStore.getState().setLimitStats(currentStats);
          continue;
        }
      }

      let meta: TrackMeta | null = null;
      let dbTrack: Awaited<ReturnType<typeof EngineDBService.getTrackByFilename>> = null;

      // Check Engine DJ SQLite metadata first to avoid expensive ID3 parsing & offline analysis
      if (EngineDBService.isAvailable()) {
        dbTrack = EngineDBService.getTrackByFilename(filename);
        if (!dbTrack) {
          const parsed = parseMetaFromFilename(filename);
          dbTrack = EngineDBService.getTrackByMeta(parsed.artist, parsed.title);
        }

        if (dbTrack && dbTrack.bpm && dbTrack.key) {
          const parsed = parseMetaFromFilename(filename);
          const artist =
            dbTrack.artist &&
            dbTrack.artist.trim().toLowerCase() !== 'unknown' &&
            dbTrack.artist.trim().toLowerCase() !== 'unknown artist'
              ? dbTrack.artist
              : parsed.artist;
          const title =
            dbTrack.title &&
            dbTrack.title.trim().toLowerCase() !== 'unknown' &&
            dbTrack.title.trim().toLowerCase() !== 'unknown title'
              ? dbTrack.title
              : parsed.title;

          meta = {
            filepath,
            filename,
            artist,
            title,
            duration: 180,
            bpm: dbTrack.bpm,
            key: dbTrack.key,
            genre: dbTrack.genre,
            comment: dbTrack.comment,
            label: dbTrack.label
          };
          addLog(
            'SYSTEM',
            `Engine DJ DB Match (Pre-extraction): BPM=${meta.bpm}, Key=${meta.key}, Genre=${meta.genre || 'N/A'}`
          );
        }
      }

      if (!meta) {
        // Extract ID3 metadata if not found or incomplete in Engine DJ
        meta = await extractMetadata(filepath);
        addLog('ID3', `Tags: ${meta.artist} - ${meta.title}${meta.fromCache ? ' (cached)' : ''}`);

        // Enrich with Engine DJ SQLite metadata if available but not fully matched before
        if (EngineDBService.isAvailable() && !dbTrack) {
          dbTrack = EngineDBService.getTrackByMeta(meta.artist, meta.title);
        }

        if (dbTrack) {
          if (dbTrack.bpm) meta.bpm = dbTrack.bpm;
          if (dbTrack.key) meta.key = dbTrack.key;
          if (dbTrack.genre) meta.genre = dbTrack.genre;
          if (dbTrack.comment) meta.comment = dbTrack.comment;
          if (dbTrack.label) meta.label = dbTrack.label;
          addLog(
            'SYSTEM',
            `Engine DJ DB Match: BPM=${meta.bpm || 'N/A'}, Key=${meta.key || 'N/A'}, Genre=${meta.genre || 'N/A'}`
          );
        }
      }

      // Check for backup routing from Engine DJ playlists or path
      if (EngineDBService.isAvailable() && dbTrack) {
        const trackPlaylists = EngineDBService.getTrackPlaylists(dbTrack.id);
        let matchedVibe = FOLDERS.find((vibe) =>
          trackPlaylists.some((tp) => tp.toLowerCase() === vibe.toLowerCase())
        );

        if (!matchedVibe && dbTrack.path) {
          const pathParts = dbTrack.path.toLowerCase().replace(/\\/g, '/').split('/');
          matchedVibe = FOLDERS.find((vibe) => pathParts.includes(vibe.toLowerCase()));
        }

        if (matchedVibe) {
          addLog('ROUTED', `Backup match found in Engine DJ DB -> /${matchedVibe}/${filename}`);
          await routeFile(filepath, [matchedVibe], { bpm: meta.bpm, key: meta.key });
          incrementStat('processed');
          const currentStats = CacheService.getStats();
          useStore.getState().setLimitStats(currentStats);
          continue;
        }
      }

      if (meta.bpm || meta.key || meta.genre) {
        addLog(
          'SYSTEM',
          `Physical Profile: BPM=${meta.bpm || 'N/A'}, Key=${meta.key || 'N/A'}, Genre=${meta.genre || 'N/A'}${meta.fromCache ? ' (cached)' : ''}`
        );
      }

      // Step 2: Check RAG memory for existing classification (only reuse if manually confirmed or present in collection)
      const existingExample = RAGService.findExample(meta.artist, meta.title);
      if (
        existingExample &&
        (existingExample.source === 'manual' ||
          existingExample.source === 'scan' ||
          existingExample.source === 'engine-dj')
      ) {
        addLog(
          'RAG',
          `Reusing vibe from memory -> /${existingExample.folders.join(' & /')}/${filename}`
        );
        await routeFile(filepath, existingExample.folders);

        // Increment cache hit / request saved!
        CacheService.incrementCacheHits();
        incrementStat('processed');

        // Sync stats
        const currentStats = CacheService.getStats();
        useStore.getState().setLimitStats(currentStats);
        continue;
      }

      // Extract Vibes.app acoustic intelligence
      const fullPath = path.resolve(filepath);
      const vibesData = vibesMap.get(fullPath) ?? vibesMap.get(filename) ?? null;
      let vibesProfile = '';
      if (vibesData) {
        const vNames = vibesData.assignedVibes.map((v) => `${v.name} (${v.category})`).join(', ');
        const vf = vibesData.track.vibeFeatures;
        const sp = vibesData.soundProfile;
        vibesProfile = `=== Vibes.app Acoustic & Semantic Blueprint ===
- Assigned Vibes: ${vNames || 'None'}
- Sub-Bass: ${vf?.band_sub_bass_mean !== undefined ? `${vf.band_sub_bass_mean.toFixed(1)} dB` : 'N/A'} | Mid: ${vf?.band_mid_mean !== undefined ? `${vf.band_mid_mean.toFixed(1)} dB` : 'N/A'} | High: ${vf?.band_high_mean !== undefined ? `${vf.band_high_mean.toFixed(1)} dB` : 'N/A'}
- Onset Density: ${vf?.onset_density !== undefined ? `${vf.onset_density.toFixed(1)} onsets/sec` : 'N/A'}
- Spectral Centroid: ${vf?.spec_centroid_mean !== undefined ? `${vf.spec_centroid_mean.toFixed(0)} Hz` : 'N/A'} | Flatness: ${vf?.spec_flatness_mean !== undefined ? vf.spec_flatness_mean.toFixed(3) : 'N/A'}
- Energy Dynamics: Peak=${sp?.peakEnergy !== undefined ? sp.peakEnergy.toFixed(2) : 'N/A'}, Avg=${sp?.avgEnergy !== undefined ? sp.avgEnergy.toFixed(2) : 'N/A'}, Variance=${sp?.energyVariance !== undefined ? sp.energyVariance.toFixed(2) : 'N/A'}
- Structural Shape (16-bin Energy): [${sp?.energyShape && sp.energyShape.length > 0 ? sp.energyShape.map((n) => n.toFixed(2)).join(', ') : 'N/A'}]
=================================================`;
        addLog(
          'SYSTEM',
          `Vibes Intelligence: ${vibesData.assignedVibes.length} vibes, Peak Energy=${sp?.peakEnergy !== undefined ? sp.peakEnergy.toFixed(2) : 'N/A'}`
        );
      }

      // Step 2.5: Check LLM cache by artist & title to avoid Spotify/YouTube/Vector calls
      const fastCached = CacheService.getCacheByArtistTitle(meta.artist, meta.title);
      if (fastCached) {
        addLog(
          'RAG',
          `Reusing cached Gemini response -> /${fastCached.folders.join(' & /')}/${filename}`
        );

        const cachedPassport = buildPassport({
          meta,
          vibesData
        });
        const cachedPassportSummary = buildPassportSummary(cachedPassport, vibesData, true);
        const cachedPassportSummaryForPlayer = buildPassportSummary(
          cachedPassport,
          vibesData,
          false,
          false
        );
        addLog('PASSPORT', cachedPassportSummary);

        states.push({
          filepath,
          filename,
          meta,
          spotifyFeatures: null,
          spotifyProfile: '',
          vibesData,
          vibesProfile,
          physicalProfile: '',
          ragContext: '',
          personalHints: '',
          networkContext: '',
          contextHash: '',
          vectorNeighbors: [],
          scoutResult: null,
          ragHit: false,
          cacheHit: true,
          llmResponse: fastCached,
          passportSummary: cachedPassportSummary,
          passportSummaryForPlayer: cachedPassportSummaryForPlayer
        });
        continue;
      }

      // SPOTIFY DISABLED: Spotify Web API is closed / inaccessible for personal developer keys.
      // Replaced by Vibes.app acoustic intelligence and physical audio blueprint.
      const spotifyProfile = '';
      const spotifyFeatures: SpotifyAudioFeatures | null = null;

      // Build physical metadata blueprint
      let physicalProfile = '';
      if (meta.bpm || meta.key || meta.genre || meta.comment || meta.label) {
        physicalProfile = `=== Physical Audio Blueprint ===
${meta.bpm ? `- BPM: ${meta.bpm}\n` : ''}${meta.key ? `- Key: ${meta.key}\n` : ''}${meta.genre ? `- Genre: ${meta.genre}\n` : ''}${meta.comment ? `- Comment: ${meta.comment}\n` : ''}${meta.label ? `- Label: ${meta.label}\n` : ''}================================`;
      }

      // Step 3: Gather context for LLM
      const ragContext = RAGService.getContext();
      const personalHints = RAGService.getPersonalHints();
      if (ragContext || personalHints) {
        addLog('SYSTEM', 'Context loaded: few-shot examples & personal preferences injected');
      }

      // YouTube Network Scout — search for playlist context
      let networkContext = '';
      let scoutResult: Awaited<ReturnType<typeof NetworkScoutService.getTrackContext>> | null =
        null;
      if (YT_SCOUT_ENABLED) {
        addLog('YT_SEARCH', `Searching YouTube context for ${meta.artist} - ${meta.title}...`);
        scoutResult = await NetworkScoutService.getTrackContext(meta.artist, meta.title);

        if (scoutResult.error) {
          addLog('ERROR', `YouTube Search Error: ${scoutResult.error}`);
        }

        if (scoutResult.playlists.length > 0) {
          if (scoutResult.source === 'cache') {
            const playlistNames = scoutResult.playlists.map((p) => p.title).join(', ');
            addLog(
              'YT_CACHE_HIT',
              `Vibe matched from cached playlist: "${playlistNames}" (network saved)`
            );
            CacheService.incrementCacheHits();
            const currentStats = CacheService.getStats();
            useStore.getState().setLimitStats(currentStats);
          } else {
            const playlistNames = scoutResult.playlists.map((p) => p.title).join(', ');
            addLog('YT_HIT', `Found in YouTube mix: "${playlistNames}" — playlist saved to memory`);
          }

          networkContext = NetworkScoutService.formatForPrompt(scoutResult);

          // --- Live m.db Bridging Logic ---
          if (EngineDBService.isAvailable()) {
            const dbTracks = EngineDBService.getTracks();
            const matches: string[] = [];

            const cleanMetadataString = (s: string): string => {
              return s
                .replace(
                  /\s*[[()](?:original|extended|radio|dub|club|official|lyric)?\s*(?:mix|edit|version|video|audio|track|remix)?[\])]/gi,
                  ''
                )
                .trim();
            };

            const normalizeKey = (art: string, ttl: string): string => {
              return `${cleanMetadataString(art).toLowerCase()}|${cleanMetadataString(ttl).toLowerCase()}`;
            };

            for (const neighbor of scoutResult.neighbors) {
              const neighborKey = normalizeKey(neighbor.artist, neighbor.title);
              const mdbMatch = dbTracks.find(
                (t) =>
                  normalizeKey(t.artist || 'Unknown', t.title || t.filename || 'Unknown') ===
                  neighborKey
              );

              if (mdbMatch) {
                const pathParts = mdbMatch.path.toLowerCase().split(/[/\\]/);
                const folder = FOLDERS.find((f) => pathParts.includes(f.toLowerCase()));
                if (folder) {
                  matches.push(
                    `- Neighbor track "${neighbor.artist} - ${neighbor.title}" is already sorted in your library folder: "${folder}"`
                  );
                }
              }
            }

            if (matches.length > 0) {
              let dbMatchContext =
                '\n\n=== High-Priority Library Match Context (YouTube neighbors already sorted in your library) ===\n';
              dbMatchContext +=
                'These tracks are in the same playlists/mixes as the target track on YouTube, and you have already manually sorted them in these vibe folders. Give these folders the HIGHEST priority:\n';
              dbMatchContext += matches.join('\n');
              dbMatchContext +=
                '\n==================================================================================================';
              networkContext += dbMatchContext;
              addLog(
                'SYSTEM',
                `Mapped ${matches.length} YouTube neighbor tracks directly to your library vibes!`
              );
            }
          }
        }
      }

      // Vector similarity search
      let vectorNeighbors: VectorNeighbor[] = [];
      const vectorCount = EmbeddingService.getVectorCount();
      if (vectorCount > 0 && process.env.GEMINI_API_KEY) {
        try {
          const ytPlaylistsForPassport = scoutResult?.playlists ?? [];
          const vectorResult = await RAGService.getVectorContext(
            meta.artist,
            meta.title,
            meta,
            spotifyFeatures,
            ytPlaylistsForPassport,
            undefined,
            15, // Fetch 15 neighbors for consensus
            vibesData
          );
          vectorNeighbors = vectorResult.neighbors;

          if (vectorNeighbors.length > 0) {
            const topFolders = [...new Set(vectorNeighbors.slice(0, 3).map((n) => n.folder))].join(
              ', '
            );
            addLog(
              'SYSTEM',
              `Vector search: ${vectorNeighbors.length} neighbors found → top folders: ${topFolders}`
            );
          }
        } catch {
          // ignore
        }
      }

      // Assemble semantic track passport and log diagnostics
      const passport = buildPassport({
        meta,
        spotify: spotifyFeatures,
        ytPlaylists: scoutResult?.playlists ?? [],
        vibesData
      });
      const passportSummary = buildPassportSummary(passport, vibesData, true);
      const passportSummaryForPlayer = buildPassportSummary(passport, vibesData, false, false);
      addLog('PASSPORT', passportSummary);
      logToFile(
        'PASSPORT_FULL',
        `\n--- Track Passport: ${meta.artist} - ${meta.title} ---\n${passport.text}\n---------------------------------------------------`
      );

      const vectorContextFormatted = LLMService.formatVectorNeighborsContext(
        vectorNeighbors.slice(0, 5)
      );
      const contextHash = CacheService.generateContextHash(
        meta.artist,
        meta.title,
        ragContext,
        personalHints,
        networkContext,
        physicalProfile,
        spotifyProfile,
        vectorContextFormatted + '\n' + vibesProfile
      );

      // Check offline cache
      const cachedResponse = CacheService.getTrackCache(meta.artist, meta.title, contextHash);

      states.push({
        filepath,
        filename,
        meta,
        spotifyFeatures,
        spotifyProfile,
        vibesData,
        vibesProfile,
        physicalProfile,
        ragContext,
        personalHints,
        networkContext,
        contextHash,
        vectorNeighbors,
        scoutResult,
        ragHit: false,
        cacheHit: !!cachedResponse,
        llmResponse: cachedResponse || undefined,
        passportSummary,
        passportSummaryForPlayer
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('ERROR', `Failed prepping track ${filepath}: ${msg}`);
    }
  }

  // Filter out states that don't need Gemini API
  const needLLM = states.filter((s) => !s.cacheHit);

  if (needLLM.length > 0) {
    useStore.getState().setLLMAnalyzing(true);

    // Map each state to BatchTrackInput
    const batchInputs: LLMService.BatchTrackInput[] = needLLM.map((s) => ({
      trackId: s.filename,
      artist: s.meta.artist,
      title: s.meta.title,
      bpm: s.meta.bpm || s.vibesData?.track.bpm || null,
      key: s.meta.key || s.vibesData?.track.key || null,
      genre: s.meta.genre || null,
      energy: s.spotifyFeatures?.energy || s.vibesData?.soundProfile?.avgEnergy || null,
      valence: s.spotifyFeatures?.valence || null,
      acousticness: s.spotifyFeatures?.acousticness || null,
      vectorNeighbors: s.vectorNeighbors,
      youtubeContext: s.networkContext,
      vibesContext: s.vibesProfile
    }));

    addLog('SYSTEM', `Sending batch of ${needLLM.length} track(s) to Gemini for analysis...`);

    try {
      const batchResults = await LLMService.classifyTracksBatch(batchInputs);

      // Map results back to states
      for (const res of batchResults) {
        const matchState = needLLM.find((s) => s.filename === res.trackId);
        if (matchState) {
          matchState.llmResponse = {
            folders: res.folders,
            reasoning: res.reasoning,
            confidence: res.confidence
          };
          addLog('LLM_REASONING', `${matchState.filename} ➔ ${res.reasoning}`);

          // Cache raw LLM response immediately to prevent losing it if the process exits before routing completes
          CacheService.saveTrackCache(
            matchState.meta.artist,
            matchState.meta.title,
            matchState.contextHash,
            matchState.llmResponse
          );
        }
      }
    } catch (err) {
      let limitExceeded = false;
      let missingApiKey = false;
      let networkError = false;
      let schemaError = false;
      let errorMsg: string;

      if (err instanceof LLMService.RequestLimitExceededError) {
        limitExceeded = true;
        errorMsg = 'Daily API request limit reached';
      } else if (err instanceof LLMService.MissingApiKeyError) {
        missingApiKey = true;
        errorMsg = 'Configuration: GEMINI_API_KEY is missing';
      } else if (
        err instanceof Error &&
        (err.name === 'ZodError' ||
          err.message.includes('JSON') ||
          err.message.includes('parsing') ||
          err.message.includes('validation'))
      ) {
        schemaError = true;
        errorMsg = 'Error: Invalid schema response format';
      } else {
        networkError = true;
        errorMsg = 'Network Error: Google Gemini API unreachable';
      }

      for (const s of needLLM) {
        s.limitExceeded = limitExceeded;
        s.missingApiKey = missingApiKey;
        s.networkError = networkError;
        s.schemaError = schemaError;
        s.errorMsg = errorMsg;
        s.llmResponse = {
          folders: [],
          reasoning: errorMsg,
          confidence: 0
        };
      }
    }

    useStore.getState().setLLMAnalyzing(false);
  }

  // Step 5: Sequentially route/prompt for each track in the batch
  for (const s of states) {
    const llmResponse = s.llmResponse || {
      folders: [],
      reasoning: 'No response generated',
      confidence: 0
    };
    const hasError = s.limitExceeded || s.missingApiKey || s.networkError || s.schemaError;
    const bypassed =
      !s.meta.bpm &&
      !s.meta.key &&
      !s.meta.genre &&
      s.networkContext.trim().length === 0 &&
      s.spotifyProfile.length === 0;

    if (bypassed && !s.cacheHit) {
      addLog(
        'SYSTEM',
        `No YouTube context, Spotify context, or physical metadata found for ${s.filename}. Bypassing Gemini.`
      );
    }

    const shouldAutoRoute =
      !FORCE_MANUAL_MODE &&
      !bypassed &&
      !hasError &&
      llmResponse.confidence >= CONFIDENCE_THRESHOLD;

    let selectedFolders: string[];

    if (s.cacheHit && shouldAutoRoute) {
      const isConsensus = llmResponse.reasoning.includes('Vector consensus');
      addLog(
        'RAG',
        `Reusing vibe from ${isConsensus ? 'Vector Consensus' : 'Gemini Cache'} -> /${llmResponse.folders.join(' & /')}/${s.filename}`
      );
      selectedFolders = llmResponse.folders;
      await routeFile(s.filepath, selectedFolders, { bpm: s.meta.bpm, key: s.meta.key });
      CacheService.incrementCacheHits();
    } else if (shouldAutoRoute) {
      addLog(
        'RAG',
        `High LLM confidence (${llmResponse.confidence}) for ${s.filename}: automatically routing -> /${llmResponse.folders.join(' & /')}`
      );
      selectedFolders = llmResponse.folders;
      await routeFile(s.filepath, selectedFolders, { bpm: s.meta.bpm, key: s.meta.key });

      RAGService.addExample({
        artist: s.meta.artist,
        title: s.meta.title,
        folders: selectedFolders,
        reasoning: llmResponse.reasoning,
        source: 'auto',
        ts: Date.now()
      });

      const updatedRagStats = RAGService.getStats();
      useStore.getState().setRagStatus('ready', {
        total: updatedRagStats.total,
        folders: updatedRagStats.folders,
        scannedAt: Date.now()
      });
      useStore.getState().setGlobalStats(getGlobalStats());
    } else {
      const reasonText = FORCE_MANUAL_MODE
        ? `Force Manual Mode enabled. Prompting manual override for ${s.filename}...`
        : hasError
          ? `Error occurred (${s.errorMsg}). Prompting user override...`
          : bypassed
            ? `No context signal for ${s.filename}. Prompting manual override...`
            : `Low LLM confidence (${llmResponse.confidence} < ${CONFIDENCE_THRESHOLD}) for ${s.filename}. Prompting user override...`;

      addLog('NEEDS_MANUAL', reasonText);
      incrementStat('overrides');

      selectedFolders = await UserInteractionService.requestOverride({
        filename: s.filename,
        filepath: s.filepath,
        suggested: llmResponse.folders,
        reason: hasError
          ? s.errorMsg
          : bypassed
            ? 'No context signals'
            : `Low confidence (${llmResponse.confidence})`,
        duration: s.meta.duration,
        bpm: s.meta.bpm,
        key: s.meta.key,
        artist: s.meta.artist,
        title: s.meta.title,
        passportSummary: s.passportSummaryForPlayer || s.passportSummary
      });

      let isApprovedSuggestion = false;

      if (selectedFolders.length === 0) {
        selectedFolders = ['skipped'];
        addLog('ROUTED', `Manual routing skipped: track moved to /skipped/${s.filename}`);
      } else {
        isApprovedSuggestion =
          !hasError &&
          !bypassed &&
          selectedFolders.length === llmResponse.folders.length &&
          selectedFolders.every((f) => llmResponse.folders.includes(f));

        addLog(
          'ROUTED',
          `${isApprovedSuggestion ? 'Auto-routing approved' : 'Manual routing'} -> /${selectedFolders.join(' & /')}/${s.filename}`
        );
      }

      await routeFile(s.filepath, selectedFolders, { bpm: s.meta.bpm, key: s.meta.key });

      // Save to offline cache
      const vectorContextFormatted = LLMService.formatVectorNeighborsContext(s.vectorNeighbors);
      const contextHash = CacheService.generateContextHash(
        s.meta.artist,
        s.meta.title,
        s.ragContext,
        s.personalHints,
        s.networkContext,
        s.physicalProfile,
        s.spotifyProfile,
        vectorContextFormatted
      );

      CacheService.saveTrackCache(s.meta.artist, s.meta.title, contextHash, {
        folders: selectedFolders,
        reasoning: isApprovedSuggestion
          ? llmResponse.reasoning
          : selectedFolders.includes('skipped')
            ? 'Track skipped by user'
            : 'Routed via manual user override checklist',
        confidence: isApprovedSuggestion ? llmResponse.confidence : 1.0
      });

      // Update RAG memory
      RAGService.addExample({
        artist: s.meta.artist,
        title: s.meta.title,
        folders: selectedFolders,
        overriddenFolders:
          !isApprovedSuggestion && llmResponse.folders.length > 0 ? llmResponse.folders : undefined,
        reasoning: isApprovedSuggestion
          ? llmResponse.reasoning
          : selectedFolders.includes('skipped')
            ? 'Track skipped by user'
            : 'Routed via manual user override checklist',
        source: isApprovedSuggestion ? 'auto' : 'manual',
        ts: Date.now()
      });

      // Sync RAG memory stats to UI
      const updatedRagStats = RAGService.getStats();
      useStore.getState().setRagStatus('ready', {
        total: updatedRagStats.total,
        folders: updatedRagStats.folders,
        scannedAt: Date.now()
      });
      useStore.getState().setGlobalStats(getGlobalStats());

      // Store vector asynchronously
      if (process.env.GEMINI_API_KEY) {
        EmbeddingService.storeTrackVector(
          s.meta.artist,
          s.meta.title,
          selectedFolders[0],
          s.meta,
          s.spotifyFeatures,
          s.scoutResult?.playlists ?? [],
          undefined,
          s.vibesData
        ).catch(() => {});
      }

      // Persist Vibes intelligence to cratemind.db
      if (s.vibesData && selectedFolders[0]) {
        try {
          const vf = s.vibesData.track.vibeFeatures;
          const sp = s.vibesData.soundProfile;
          saveTrackIntelligence({
            artist: s.meta.artist,
            title: s.meta.title,
            filepath: s.vibesData.track.filepath,
            folder: selectedFolders[0],
            bpm: s.vibesData.track.bpm ?? (s.meta.bpm ? Number(s.meta.bpm) : null),
            key: s.vibesData.track.key ?? s.meta.key ?? null,
            assignedVibes: s.vibesData.assignedVibes,
            subBassDb: vf?.band_sub_bass_mean ?? null,
            bassDb: vf?.band_bass_mean ?? null,
            midDb: vf?.band_mid_mean ?? null,
            highDb: vf?.band_high_mean ?? null,
            onsetDensity: vf?.onset_density ?? null,
            peakEnergy: sp?.peakEnergy ?? null,
            avgEnergy: sp?.avgEnergy ?? null,
            energyVariance: sp?.energyVariance ?? null,
            specCentroid: vf?.spec_centroid_mean ?? null,
            specFlatness: vf?.spec_flatness_mean ?? null,
            energyShape: sp?.energyShape ?? null,
            drumShape: sp?.drumShape ?? null,
            dropRatio: sp?.dropRatio ?? null,
            buildupRatio: sp?.buildupRatio ?? null,
            breakdownRatio: sp?.breakdownRatio ?? null,
            clapEmbedding: s.vibesData.track.clapEmbedding ?? null
          });
        } catch (dbErr) {
          logToFile(
            'TRACK_PROCESSOR',
            `Failed to save intelligence for ${s.filename}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`
          );
        }
      }
    }

    incrementStat('processed');
    const currentStats = CacheService.getStats();
    useStore.getState().setLimitStats(currentStats);
  }

  // After processing the chunk, check if Incoming folder contains any remaining audio files
  try {
    if (fs.existsSync(INCOMING_DIR)) {
      const files = fs.readdirSync(INCOMING_DIR);
      const audioFiles = files.filter((f) => {
        const ext = path.extname(f).toLowerCase();
        return AUDIO_EXTENSIONS.includes(ext as (typeof AUDIO_EXTENSIONS)[number]);
      });

      if (audioFiles.length === 0) {
        useStore.getState().clearLogs();
        useStore
          .getState()
          .addLog('SYSTEM', 'All tracks have been processed! Incoming folder is clean.');
      }
    }
  } catch {
    // ignore
  }
}

function parseMetaFromFilename(filename: string): { artist: string; title: string } {
  let nameWithoutExt = filename;
  const ext = path.extname(filename);
  if (ext) {
    nameWithoutExt = filename.slice(0, -ext.length);
  }
  nameWithoutExt = nameWithoutExt.replace(/_-_/g, ' - ');

  const separators = [' - ', '-', '_'];
  let parts: string[] = [nameWithoutExt];
  let usedSeparator = '';

  for (const sep of separators) {
    const split = nameWithoutExt.split(sep);
    if (split.length >= 2) {
      parts = split;
      usedSeparator = sep;
      break;
    }
  }

  let artist = 'Unknown';
  let title: string;

  if (parts.length >= 2) {
    artist = parts[0]?.replace(/_/g, ' ').trim() || 'Unknown';
    const joinedTitle = parts.slice(1).join(usedSeparator === '_' ? ' ' : usedSeparator);
    title = joinedTitle.replace(/_/g, ' ').trim() || 'Unknown';
  } else {
    title = nameWithoutExt.replace(/_/g, ' ').trim() || 'Unknown';
  }

  const cleanPrefix = (str: string): string => {
    return str.replace(/^\d+[\s.-]+/, '').trim();
  };

  return {
    artist: cleanPrefix(artist),
    title: cleanPrefix(title)
  };
}
