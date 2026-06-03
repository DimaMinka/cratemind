import * as path from 'path';
import { useStore } from './UIService.js';
import * as RAGService from './RAGService.js';
import * as LLMService from './LLMService.js';
import { extractMetadata } from './ID3Service.js';
import { routeFile } from './RoutingService.js';
import * as CacheService from './CacheService.js';
import * as UserInteractionService from './UserInteractionService.js';
import * as NetworkScoutService from './NetworkScoutService.js';
import * as EngineDBService from './EngineDBService.js';
import * as SpotifyService from './SpotifyService.js';
import * as EmbeddingService from './EmbeddingService.js';
import { YT_SCOUT_ENABLED, CONFIDENCE_THRESHOLD, FOLDERS } from '../config.js';
import { LLMResponse, VectorNeighbor, TrackMeta, NetworkScoutResult } from '../types.js';
import { SpotifyAudioFeatures } from './SpotifyService.js';

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
}

export async function processTracksBatch(filepaths: string[]): Promise<void> {
  const addLog = useStore.getState().addLog;
  const incrementStat = useStore.getState().incrementStat;

  if (filepaths.length === 0) return;

  const states: TrackBatchState[] = [];

  // Step 1: Metadata Extraction & Local RAG/Cache Checking
  for (const filepath of filepaths) {
    try {
      const filename = path.basename(filepath);
      addLog('DETECTED', `Discovered track: ${filename}`);

      // Extract ID3 metadata
      const meta = await extractMetadata(filepath);
      addLog('ID3', `Tags: ${meta.artist} - ${meta.title}`);

      // Enrich with Engine DJ SQLite metadata if available
      if (EngineDBService.isAvailable()) {
        const dbTrack = EngineDBService.getTrackByMeta(meta.artist, meta.title);
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

      if (meta.bpm || meta.key || meta.genre) {
        addLog(
          'SYSTEM',
          `Physical Profile: BPM=${meta.bpm || 'N/A'}, Key=${meta.key || 'N/A'}, Genre=${meta.genre || 'N/A'}`
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

      // Query Spotify Audio Features if configured
      let spotifyProfile = '';
      let spotifyFeatures: Awaited<ReturnType<typeof SpotifyService.getTrackFeatures>> = null;
      try {
        spotifyFeatures = await SpotifyService.getTrackFeatures(meta.artist, meta.title);
        if (spotifyFeatures) {
          addLog(
            'SYSTEM',
            `Spotify Acoustic: Energy=${spotifyFeatures.energy ?? 'N/A'}, Genres=${spotifyFeatures.genres?.join(', ') || 'None'}`
          );
          spotifyProfile = `=== Spotify Acoustic Blueprint ===
- Energy: ${spotifyFeatures.energy !== null && spotifyFeatures.energy !== undefined ? spotifyFeatures.energy : 'N/A'} (0 = calm/ambient, 1 = heavy peak-time)
- Danceability: ${spotifyFeatures.danceability !== null && spotifyFeatures.danceability !== undefined ? spotifyFeatures.danceability : 'N/A'} (0 = erratic/non-dance, 1 = structured groove)
- Acousticness: ${spotifyFeatures.acousticness !== null && spotifyFeatures.acousticness !== undefined ? spotifyFeatures.acousticness : 'N/A'} (0 = highly synthetic/processed, 1 = natural acoustic/wooden)
- Instrumentalness: ${spotifyFeatures.instrumentalness !== null && spotifyFeatures.instrumentalness !== undefined ? spotifyFeatures.instrumentalness : 'N/A'} (0 = highly vocal-driven, 1 = purely instrumental)
- Valence: ${spotifyFeatures.valence !== null && spotifyFeatures.valence !== undefined ? spotifyFeatures.valence : 'N/A'} (0 = sad/melancholic/dark, 1 = happy/bright/positive)
- Spotify Genres: ${spotifyFeatures.genres && spotifyFeatures.genres.length > 0 ? spotifyFeatures.genres.join(', ') : 'N/A'}
==================================`;
        }
      } catch {
        // Silence Spotify errors to keep the classification robust
      }

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

        if (scoutResult.playlists.length > 0) {
          if (scoutResult.source === 'cache') {
            const playlistNames = scoutResult.playlists.map((p) => p.title).join(', ');
            addLog(
              'YT_CACHE_HIT',
              `Vibe matched from cached playlist: "${playlistNames}" (network saved)`
            );
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
            ytPlaylistsForPassport
          );
          vectorNeighbors = vectorResult.neighbors;

          if (vectorNeighbors.length > 0) {
            const topFolders = [...new Set(vectorNeighbors.slice(0, 3).map((n) => n.folder))].join(
              ', '
            );
            addLog(
              'SYSTEM',
              `Vector search: ${vectorNeighbors.length} neighbors found → folders: ${topFolders}`
            );
          }
        } catch {
          // ignore
        }
      }

      const vectorContextFormatted = LLMService.formatVectorNeighborsContext(vectorNeighbors);
      const contextHash = CacheService.generateContextHash(
        meta.artist,
        meta.title,
        ragContext,
        personalHints,
        networkContext,
        physicalProfile,
        spotifyProfile,
        vectorContextFormatted
      );

      // Check offline cache
      const cachedResponse = CacheService.getTrackCache(meta.artist, meta.title, contextHash);

      states.push({
        filepath,
        filename,
        meta,
        spotifyFeatures,
        spotifyProfile,
        physicalProfile,
        ragContext,
        personalHints,
        networkContext,
        contextHash,
        vectorNeighbors,
        scoutResult,
        ragHit: false,
        cacheHit: !!cachedResponse,
        llmResponse: cachedResponse || undefined
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('ERROR', `Failed prepping track ${filepath}: ${msg}`);
      incrementStat('errors');
    }
  }

  // Filter out states that don't need Gemini API
  const needLLM = states.filter((s) => !s.cacheHit);

  if (needLLM.length > 0) {
    addLog('SYSTEM', `Sending batch of ${needLLM.length} tracks to Gemini...`);
    useStore.getState().setLLMAnalyzing(true);

    // Map each state to BatchTrackInput
    const batchInputs: LLMService.BatchTrackInput[] = needLLM.map((s) => ({
      trackId: s.filename,
      artist: s.meta.artist,
      title: s.meta.title,
      bpm: s.meta.bpm || null,
      key: s.meta.key || null,
      genre: s.meta.genre || null,
      energy: s.spotifyFeatures?.energy || null,
      valence: s.spotifyFeatures?.valence || null,
      acousticness: s.spotifyFeatures?.acousticness || null,
      vectorNeighbors: s.vectorNeighbors,
      youtubeContext: s.networkContext
    }));

    try {
      const batchResults = await LLMService.classifyTracksBatch(batchInputs);
      useStore.getState().setLLMAnalyzing(false);

      // Map results back to states
      for (const res of batchResults) {
        const matchState = needLLM.find((s) => s.filename === res.trackId);
        if (matchState) {
          matchState.llmResponse = {
            folders: res.folders,
            reasoning: res.reasoning,
            confidence: res.confidence
          };
          addLog('LLM_REASONING', `[LLM reasoning for ${matchState.filename}] ${res.reasoning}`);

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
      useStore.getState().setLLMAnalyzing(false);
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
      !bypassed && !hasError && llmResponse.confidence >= CONFIDENCE_THRESHOLD;

    let selectedFolders: string[];

    if (s.cacheHit && shouldAutoRoute) {
      addLog(
        'RAG',
        `Reusing vibe from Gemini Cache -> /${llmResponse.folders.join(' & /')}/${s.filename}`
      );
      selectedFolders = llmResponse.folders;
      await routeFile(s.filepath, selectedFolders);
      CacheService.incrementCacheHits();
    } else if (shouldAutoRoute) {
      addLog(
        'RAG',
        `High LLM confidence (${llmResponse.confidence}) for ${s.filename}: automatically routing -> /${llmResponse.folders.join(' & /')}`
      );
      selectedFolders = llmResponse.folders;
      await routeFile(s.filepath, selectedFolders);
    } else {
      const reasonText = hasError
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
        duration: s.meta.duration
      });

      if (selectedFolders.length === 0) {
        addLog('ROUTED', `Manual routing skipped: track left in Incoming`);
      } else {
        const isApprovedSuggestion =
          !hasError &&
          !bypassed &&
          selectedFolders.length === llmResponse.folders.length &&
          selectedFolders.every((f) => llmResponse.folders.includes(f));

        addLog(
          'ROUTED',
          `${isApprovedSuggestion ? 'Auto-routing approved' : 'Manual routing'} -> /${selectedFolders.join(' & /')}/${s.filename}`
        );

        await routeFile(s.filepath, selectedFolders);

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
            : 'Routed via manual user override checklist',
          confidence: isApprovedSuggestion ? llmResponse.confidence : 1.0
        });

        // Update RAG memory
        RAGService.addExample({
          artist: s.meta.artist,
          title: s.meta.title,
          folders: selectedFolders,
          overriddenFolders:
            !isApprovedSuggestion && llmResponse.folders.length > 0
              ? llmResponse.folders
              : undefined,
          reasoning: isApprovedSuggestion
            ? llmResponse.reasoning
            : 'Routed via manual user override checklist',
          source: isApprovedSuggestion ? 'auto' : 'manual',
          ts: Date.now()
        });

        // Store vector asynchronously
        if (process.env.GEMINI_API_KEY) {
          EmbeddingService.storeTrackVector(
            s.meta.artist,
            s.meta.title,
            selectedFolders[0],
            s.meta,
            s.spotifyFeatures,
            s.scoutResult?.playlists ?? []
          ).catch(() => {});
        }
      }
    }

    incrementStat('processed');
    const currentStats = CacheService.getStats();
    useStore.getState().setLimitStats(currentStats);
  }
}
