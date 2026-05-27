import * as path from 'path';
import { useStore } from './UIService.js';
import * as RAGService from './RAGService.js';
import * as LLMService from './LLMService.js';
import { extractMetadata } from './ID3Service.js';
import { routeFile } from './RoutingService.js';
import * as CacheService from './CacheService.js';
import * as UserInteractionService from './UserInteractionService.js';

/**
 * TrackProcessor.ts
 *
 * Business orchestrator: declarative linear pipeline for processing
 * a single audio track from ID3 extraction through to final routing.
 *
 * Pipeline steps:
 * 1. ID3 metadata extraction
 * 2. RAG memory lookup (instant route on hit)
 * 3. [Future: YouTube Network Scout — Phase 4]
 * 4. LLM classification via Gemini
 * 5. User interaction (ManualOverride)
 * 6. File routing to vibe crates
 * 7. RAG memory update
 *
 * Extracted from FSService to separate business logic from
 * infrastructure concerns (chokidar, PQueue).
 */

export async function processTrack(filepath: string): Promise<void> {
  const addLog = useStore.getState().addLog;
  const incrementStat = useStore.getState().incrementStat;

  try {
    const filename = path.basename(filepath);
    addLog('DETECTED', `Discovered track: ${filename}`);

    // Step 1: Extract ID3 metadata
    const meta = await extractMetadata(filepath);
    addLog('ID3', `Tags: ${meta.artist} - ${meta.title}`);

    // Step 2: Check RAG memory for existing classification
    const existingExample = RAGService.findExample(meta.artist, meta.title);
    if (existingExample) {
      addLog(
        'RAG',
        `Reusing vibe from memory -> /${existingExample.folders.join(' & /')}/${filename}`
      );
      await routeFile(filepath, existingExample.folders);

      // Increment cache hit / request saved!
      CacheService.incrementCacheHits();

      incrementStat('processed');

      // Sync cache hits and daily limits stats to the global Zustand store
      const currentStats = CacheService.getStats();
      useStore.getState().setLimitStats(currentStats);
      return;
    }

    // Step 3: Gather context for LLM
    const ragContext = RAGService.getContext();
    const personalHints = RAGService.getPersonalHints();
    if (ragContext || personalHints) {
      addLog('SYSTEM', 'Context loaded: few-shot examples & personal preferences injected');
    }

    // Compute hash AFTER all context is gathered (RAG + personal hints)
    // Note: In Phase 4, networkContext will be added here after YouTube scout step
    const contextHash = CacheService.generateContextHash(
      meta.artist,
      meta.title,
      ragContext,
      personalHints
    );

    // Step 4: LLM classification
    let llmResponse;
    let limitExceeded = false;
    let missingApiKey = false;
    let networkError = false;
    let schemaError = false;
    let errorMsg = '';

    try {
      useStore.getState().setLLMAnalyzing(true);
      llmResponse = await LLMService.classifyTrack(
        meta.artist,
        meta.title,
        ragContext,
        personalHints
      );
      useStore.getState().setLLMAnalyzing(false);
      addLog('LLM_REASONING', `[LLM reasoning] ${llmResponse.reasoning}`);
    } catch (err) {
      useStore.getState().setLLMAnalyzing(false);
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

      llmResponse = {
        folders: [],
        reasoning: errorMsg,
        confidence: 0
      };
    }

    // Step 5: User interaction (ManualOverride)
    const hasError = limitExceeded || missingApiKey || networkError || schemaError;

    const reasonText = hasError
      ? `Error occurred (${errorMsg}). Prompting user override...`
      : `New track discovered. Reviewing suggestions...`;

    addLog('NEEDS_MANUAL', reasonText);
    incrementStat('overrides');

    const selectedFolders = await UserInteractionService.requestOverride({
      filename,
      filepath,
      suggested: llmResponse.folders,
      reason: hasError ? errorMsg : undefined,
      duration: meta.duration
    });

    // Step 6: Route file and update memory
    if (selectedFolders.length === 0) {
      addLog('ROUTED', `Manual routing skipped: track left in Incoming`);
    } else {
      const isApprovedSuggestion =
        !hasError &&
        selectedFolders.length === llmResponse.folders.length &&
        selectedFolders.every((f) => llmResponse.folders.includes(f));

      addLog(
        'ROUTED',
        `${isApprovedSuggestion ? 'Auto-routing approved' : 'Manual routing'} -> /${selectedFolders.join(' & /')}/${filename}`
      );

      await routeFile(filepath, selectedFolders);

      // Always overwrite the cache with the user's FINAL decision.
      // Without this, the cache stores the LLM's original suggestion and
      // returns the wrong vibe on subsequent runs — even when the user
      // manually picked something different via the override checklist.
      CacheService.saveTrackCache(meta.artist, meta.title, contextHash, {
        folders: selectedFolders,
        reasoning: isApprovedSuggestion
          ? llmResponse.reasoning
          : 'Routed via manual user override checklist',
        confidence: isApprovedSuggestion ? llmResponse.confidence : 1.0
      });

      // Step 7: Update RAG memory
      RAGService.addExample({
        artist: meta.artist,
        title: meta.title,
        folders: selectedFolders,
        overriddenFolders:
          !isApprovedSuggestion && llmResponse.folders.length > 0 ? llmResponse.folders : undefined,
        reasoning: isApprovedSuggestion
          ? llmResponse.reasoning
          : 'Routed via manual user override checklist',
        source: isApprovedSuggestion ? 'auto' : 'manual',
        ts: Date.now()
      });
    }

    incrementStat('processed');

    // Sync cache hits and daily limits stats to the global Zustand store
    const currentStats = CacheService.getStats();
    useStore.getState().setLimitStats(currentStats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('ERROR', `Failed processing: ${msg}`);
    incrementStat('errors');

    // Sync stats in case limit count was incremented before failure
    const currentStats = CacheService.getStats();
    useStore.getState().setLimitStats(currentStats);
  }
}
