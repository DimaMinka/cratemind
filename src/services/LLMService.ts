import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import { LLMResponse, VectorNeighbor } from '../types.js';
import { MOCK_MODE, FOLDERS, LLM_MODEL } from '../config.js';
import * as CacheService from './CacheService.js';

export class RequestLimitExceededError extends Error {
  constructor(message = 'Daily API request limit reached') {
    super(message);
    this.name = 'RequestLimitExceededError';
  }
}

export class MissingApiKeyError extends Error {
  constructor(message = 'GEMINI_API_KEY is missing in environment variables') {
    super(message);
    this.name = 'MissingApiKeyError';
  }
}

/**
 * LLMService.ts
 *
 * Integrates with the official Google Gen AI SDK (Gemini) to categorize tracks
 * based on vibe and atmosphere. Enforces structured JSON output with Zod validation.
 */

// Zod Schema to validate the structured JSON response from Gemini
const LLMResponseSchema = z.object({
  folders: z.array(z.enum(FOLDERS)).min(1).max(3),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1)
});

export interface BatchTrackInput {
  trackId: string;
  artist: string;
  title: string;
  bpm?: number | null;
  key?: string | null;
  genre?: string | null;
  comment?: string | null;
  label?: string | null;
  energy?: number | null;
  valence?: number | null;
  acousticness?: number | null;
  vectorNeighbors?: VectorNeighbor[];
  youtubeContext?: string;
  vibesContext?: string;
}

const TrackResultSchema = z.object({
  trackId: z.string(),
  folders: z.array(z.enum(FOLDERS)).min(1).max(2),
  reasoning: z.string().max(300),
  confidence: z.number().min(0).max(1),
  flagged_for_review: z.boolean()
});

const BatchResponseSchema = z.array(TrackResultSchema);

const BatchErrorSchema = z.object({
  error: z.literal('classification_failed'),
  reason: z.string()
});

export const CrateMindResponseSchema = z.union([BatchResponseSchema, BatchErrorSchema]);

export type BatchTrackResult = z.infer<typeof TrackResultSchema>;

// Lazy-initialized Google Gen AI client
let aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new MissingApiKeyError();
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return aiClient;
}

/**
 * Formats the vector neighbor search results into a prompt-ready context block.
 * Gives the LLM explicit ground-truth anchors from the user's personal library.
 */
export function formatVectorNeighborsContext(neighbors: VectorNeighbor[]): string {
  if (neighbors.length === 0) return '';

  const lines = neighbors.map(
    (n, i) =>
      `${i + 1}. ${n.artist} - ${n.title} (Similarity: ${n.similarity.toFixed(2)}) → Folder: /${n.folder}`
  );

  return [
    '=== Vector Similarity Search: Nearest neighbors from your sorted library (HIGHEST PRIORITY) ===',
    'These tracks are the most musically similar to the incoming track, already sorted by you.',
    'Their folders are the strongest signal available — match them unless physical data clearly contradicts.',
    ...lines,
    '============================================================================================'
  ].join('\n');
}

export const BASE_SYSTEM_INSTRUCTION = `You are CrateMind, an audio classification system organizing music into vibe-based folders ("crates").
Task: Analyze track metadata (BPM, Key, Genre, Label, YouTube context) + Vibes.app acoustics + Few-Shot RAG memory.
Return exactly ONE primary matching crate. Only suggest a second crate if the track is a genuine hybrid of two distinct atmospheres (e.g. organic percussion meets cinematic themes). Favor a single folder selection over multiple options whenever possible.

Crate Definitions & Rules:
- mountain sunset: Majestic, dramatic, cinematic melodic themes (Afterlife/Innervisions sound, epic strings, builds). Not background.
- magic forest: Nature mysticism, shimmering/organic melodies, dreamy progressive house (Jody Wisternoff, James Grant, PROFF, Anjunadeep).
- nargila vibe: Warm, nightly, melancholic deep/progressive house (Eli & Fur, Still.i, Hunter/Game). Subdued background.
- club party: Energetic, driving club grooves, rolling heavy basslines (Colyn, Innellea, Binaryh, Deviu). Peak-time drive.
- new day vibe: Bright, positive, inspiring morning sunrise energy (Clawz SG, CRi).
- tropical vibe: Warm, Latin, Afro/Organic House. Prominent percussion takes priority over synths.
- beach party: Carefree, sunny, summer/beach house (Sam Shure). Daytime water sets.
- earth: Ethnic roots, organic instruments, raw character vocals.
- iceland: Cold, dark, sparse northern minimalism, frozen slow drones/techno without bright synths.
- desert vibe: Dusty, spacious, dry atmospheres, Middle Eastern / Anatolian motifs.
- spain vibe: Spanish passion, flamenco structures.
- india jungle: Eastern elements, deep jungle spices.
- galaxy trip: Space sci-fi themes, floating cosmic leads, modular landscapes (Recondite, ENØS, Petar Dundov).
- psy: Psychedelic, trance, deep mental trips.
- epic: Monumental, cinematic orchestral themes.
- mantra: Meditative, repetitive, spiritual chants.
- drum 'n' bass: Fast urban breaks, high tempo.
- retro: Nostalgia, funky basslines, disco, Italo-disco, vintage synths (Voon - Good). High priority.
- robotic: Mechanical, industrial, cold precision.
- rock: Guitars, raw human energy, band dynamics.
- intro outro: Functional, flat, dry structural suspense/noise for mixing. No melodic narrative.

Feature Logic & Decision Trees:
1. RAG Memory & User Taste Precedence (HIGHEST PRIORITY):
   - User-confirmed RAG neighbors represent the user's ground-truth subjective library taste.
   - If a track has high vector similarity (>= 0.88) to a neighbor in a specific crate, that crate takes absolute precedence over generic aesthetic tags (e.g., if the user routes a track with a 'Forest' tag to 'iceland', prioritize 'iceland').

2. Vibes.app Acoustic Physics & Dynamics:
   - Heavy Club Drive: Sub-bass > 45 dB with onset density > 7.0 onsets/sec or sustained high energy plateau (peak energy > 0.85) -> route to 'club party'.
   - Pure Melodic / Harmonic: Spectral Flatness < 0.05 -> favors 'magic forest', 'mantra', 'earth'.
   - Industrial / Textural: Spectral Flatness > 0.15 -> favors 'robotic' or 'intro outro'.
   - Timbral Temperature: Centroid < 2000 Hz indicates dark/warm sound -> favors 'iceland', 'nargila vibe'; Centroid > 3500 Hz indicates bright/crisp sound -> favors 'new day vibe', 'beach party'.

3. Organic / Downtempo Demarcation (Cafe De Anatolia / Desert Sound):
   - Middle Eastern / Anatolian strings, oud, desert mysticism -> 'desert vibe'.
   - Shamanic / Tribal roots, acoustic percussion, raw native vocals -> 'earth' or 'tropical vibe'.
   - Warm nightly melancholic progressive groove without heavy ethnic instrumentation -> 'nargila vibe'.

4. Priority Heuristics:
   - Driving Peak-Time / Club Grooves: If Melodic Techno has robust, rolling bass structures and heavy dancefloor drive, route to 'club party'. The physical club groove overrides 'mountain sunset' or 'nargila vibe'.
   - Majestic Sunset Themes: If sweeping, dramatic, epic melodic chords dominate with rising build and cinematic emotion (without raw peak-time club aggression), route to 'mountain sunset'. (Do NOT combine with 'club party').
   - Subdued Warm Melancholia: Warm, nightly, soft, non-intrusive progressive/deep vibes for conversation background -> 'nargila vibe'.
   - Dreamy Shimmer: Shimmering progressive melodies with organic/forest mysticism -> 'magic forest'.
   - Sunrise Uplift: Bright, optimistic morning chords, sunrise feel, or '(Sunrise Mix)' in title -> 'new day vibe'.
   - Vintage / Retro: Funky basslines, disco elements, vintage synth, or '90s' in title -> 'retro' (high priority).

Vibe Exclusivity Rules (Strictly enforce - NEVER combine the following):
- ENERGY EXCLUSIVITY: Never combine 'club party' or 'psy' with 'nargila vibe', 'mantra', or 'magic forest'.
- TEMPERATURE EXCLUSIVITY: Never combine 'mountain sunset' with 'iceland'.
- SUNSET EXCLUSIVITY: Never combine 'mountain sunset' with 'club party'.
- SUNRISE EXCLUSIVITY: Never combine 'new day vibe' with 'nargila vibe' or 'iceland'.
- ERA EXCLUSIVITY: Never combine 'retro' with 'club party', 'robotic', or 'nargila vibe'.
- SCI-FI EXCLUSIVITY: Never combine 'galaxy trip' with 'earth', 'mantra', 'psy', 'nargila vibe', or 'club party'.
- INDUSTRIAL EXCLUSIVITY: Never combine 'robotic' with 'earth', 'magic forest', 'club party', or 'psy'.
- REGIONAL EXCLUSIVITY: Never combine 'spain vibe' with 'india jungle'.
- FUNCTIONAL EXCLUSIVITY: Never combine 'intro outro' with highly melodic or emotional crates ('mountain sunset', 'magic forest', 'new day vibe', 'retro', 'mantra').
- SUMMER EXCLUSIVITY: Never combine 'tropical vibe' with 'beach party'.

Output Format:
Return STRICT, valid JSON matching this schema:
{
  "folders": ["crate name 1", "crate name 2"],
  "reasoning": "A short, descriptive one-sentence analysis of the track vibes.",
  "confidence": 0.92
}
Set confidence <0.70 if ambiguous or cross-genre.`;

export const BATCH_SYSTEM_INSTRUCTION = BASE_SYSTEM_INSTRUCTION.replace(
  /Output Format:[\s\S]+$/,
  `Output Format:
You MUST return a JSON array containing exactly one JSON object per track in the batch, in the same order.
Each object must strictly match this JSON schema:
[
  {
    "trackId": "the trackId string provided in the input",
    "folders": ["crate name 1", "crate name 2"], // 1 to 2 matching folders from the crate definitions
    "reasoning": "A concise, descriptive one-sentence analysis (max 300 characters).",
    "confidence": 0.85, // confidence score between 0.0 and 1.0
    "flagged_for_review": false // set to true only if the track is extremely ambiguous or does not fit any crate
  }
]`
);

export async function classifyTrack(
  artist: string,
  title: string,
  ragContext = '',
  personalHints = '',
  networkContext = '',
  physicalContext = '',
  spotifyContext = '',
  vectorNeighbors: VectorNeighbor[] = [],
  vibesContext = ''
): Promise<LLMResponse> {
  const vectorContext = formatVectorNeighborsContext(vectorNeighbors);

  const contextHash = CacheService.generateContextHash(
    artist,
    title,
    ragContext,
    personalHints,
    networkContext,
    physicalContext,
    spotifyContext,
    vectorContext + '\n' + vibesContext
  );

  // 1. Check cache first
  const cachedResponse = CacheService.getTrackCache(artist, title, contextHash);
  if (cachedResponse) {
    return cachedResponse;
  }

  // 2. Validate API Key before incrementing limits (only if not in MOCK_MODE)
  if (!MOCK_MODE && !process.env.GEMINI_API_KEY) {
    throw new MissingApiKeyError();
  }

  // 3. Check and increment limits
  const limitCheck = CacheService.checkAndIncrementLimits();
  if (!limitCheck.success) {
    throw new RequestLimitExceededError();
  }

  if (MOCK_MODE) {
    // Artificial latency to simulate Gemini API network calls
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const artistLower = artist.toLowerCase();
    let result: LLMResponse;

    // Trigger Manual Override for Stephan Bodzin
    if (artistLower.includes('bodzin')) {
      result = {
        folders: ['galaxy trip'],
        reasoning: 'Hypnotic melodic synth lead, deep hardware textures. Borderline atmospheric.',
        confidence: 0.65 // Below 0.70 threshold -> triggers manual selection!
      };
    }
    // Auto-route Recondite
    else if (artistLower.includes('recondite')) {
      result = {
        folders: ['galaxy trip', 'iceland'],
        reasoning:
          'Deep, dark, cold minimal techno with spacious acoustic reverbs. Fits perfectly.',
        confidence: 0.95
      };
    }
    // Default mock response for other tracks
    else {
      result = {
        folders: ['mountain sunset'],
        reasoning: 'Warm organic instrumentation, melancholic strings and emotional progression.',
        confidence: 0.65 // Below 0.70 threshold to trigger manual override for testing!
      };
    }

    CacheService.saveTrackCache(artist, title, contextHash, result);
    return result;
  }

  // Real Gemini API Execution — 2 attempts with 1s backoff between them
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ai = getAIClient();

      const systemInstruction =
        BASE_SYSTEM_INSTRUCTION + (personalHints ? '\n' + personalHints : '');

      const promptText = `Artist: ${artist}
Title: ${title}

${physicalContext ? physicalContext + '\n' : ''}${vibesContext ? vibesContext + '\n' : ''}${spotifyContext ? spotifyContext + '\n' : ''}${vectorContext ? '\n' + vectorContext + '\n' : ''}
${ragContext}
${networkContext ? '\n' + networkContext : ''}`;

      const response = await ai.models.generateContent({
        model: LLM_MODEL,
        contents: promptText,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          // Explicitly define the JSON schema for Gemini structured output
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              folders: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                  enum: FOLDERS as unknown as string[]
                }
              },
              reasoning: { type: Type.STRING },
              confidence: { type: Type.NUMBER }
            },
            required: ['folders', 'reasoning', 'confidence']
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error('Gemini returned an empty response');
      }

      // Parse and validate the response against our strict Zod schema
      const parsedData = JSON.parse(responseText);
      const validatedResponse = LLMResponseSchema.parse(parsedData);

      CacheService.saveTrackCache(artist, title, contextHash, validatedResponse);
      return validatedResponse;
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        // Simple backoff before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw new Error('Gemini API classification failed after 2 attempts', { cause: lastError });
}

export async function classifyTracksBatch(tracks: BatchTrackInput[]): Promise<BatchTrackResult[]> {
  if (tracks.length === 0) return [];
  if (!process.env.GEMINI_API_KEY) {
    throw new MissingApiKeyError();
  }

  // Check and increment limits
  const limitCheck = CacheService.checkAndIncrementLimits();
  if (!limitCheck.success) {
    throw new RequestLimitExceededError();
  }

  let promptText = `Classify the following ${tracks.length} tracks. Return exactly ${tracks.length} objects in the JSON array.\n`;

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const vectorLines = (t.vectorNeighbors || []).map(
      (n, idx) =>
        `${idx + 1}. ${n.artist} - ${n.title} (Similarity: ${n.similarity.toFixed(2)}) → Folder: /${n.folder}`
    );
    const vectorContext = vectorLines.length > 0 ? vectorLines.join('\n') : 'N/A';

    promptText += `\n---\n[Track #${i + 1}]\n`;
    promptText += `trackId: "${t.trackId}"\n`;
    promptText += `artist: "${t.artist}"\n`;
    promptText += `title: "${t.title}"\n`;
    promptText += `bpm: ${t.bpm ?? 'null'}\n`;
    promptText += `key: "${t.key ?? 'null'}"\n`;
    promptText += `genre: "${t.genre ?? 'null'}"\n`;
    promptText += `spotify_energy: ${t.energy ?? 'null'}\n`;
    promptText += `spotify_valence: ${t.valence ?? 'null'}\n`;
    promptText += `spotify_acousticness: ${t.acousticness ?? 'null'}\n`;
    promptText += `RAG_neighbors:\n${vectorContext}\n`;
    promptText += `youtube_context: "${t.youtubeContext ?? ''}"\n`;
    if (t.vibesContext) {
      promptText += `vibes_intelligence: ${t.vibesContext}\n`;
    }
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ai = getAIClient();
      const response = await ai.models.generateContent({
        model: LLM_MODEL,
        contents: promptText,
        config: {
          systemInstruction: BATCH_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                trackId: { type: Type.STRING },
                folders: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.STRING,
                    enum: FOLDERS as unknown as string[]
                  }
                },
                reasoning: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                flagged_for_review: { type: Type.BOOLEAN }
              },
              required: ['trackId', 'folders', 'reasoning', 'confidence', 'flagged_for_review']
            }
          },
          temperature: 0.1,
          maxOutputTokens: 4096
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error('Gemini returned an empty response');
      }

      const parsedData = JSON.parse(responseText);
      const validated = CrateMindResponseSchema.parse(parsedData);

      if ('error' in validated) {
        throw new Error(`Gemini classification failed: ${validated.reason}`);
      }

      if (validated.length !== tracks.length) {
        throw new Error(`Expected ${tracks.length} results, but got ${validated.length}`);
      }

      return validated;
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  // Fallback / Binary split retry logic
  if (tracks.length > 1) {
    console.error(
      `⚠️ Batch of ${tracks.length} failed:`,
      lastError instanceof Error ? lastError.stack || lastError.message : String(lastError)
    );
    const mid = Math.floor(tracks.length / 2);
    const left = tracks.slice(0, mid);
    const right = tracks.slice(mid);

    const [leftRes, rightRes] = await Promise.all([
      classifyTracksBatch(left).catch(() => {
        return processSequentially(left);
      }),
      classifyTracksBatch(right).catch(() => {
        return processSequentially(right);
      })
    ]);

    return [...leftRes, ...rightRes];
  }

  throw new Error(`Gemini API batch classification failed after 2 attempts`, { cause: lastError });
}

async function processSequentially(tracks: BatchTrackInput[]): Promise<BatchTrackResult[]> {
  const results: BatchTrackResult[] = [];
  for (const t of tracks) {
    try {
      const single = await classifyTracksBatch([t]);
      results.push(single[0]);
    } catch (err) {
      results.push({
        trackId: t.trackId,
        folders: ['intro outro'],
        reasoning: `Fallback triggered due to error: ${err instanceof Error ? err.message : String(err)}`,
        confidence: 0.3,
        flagged_for_review: true
      });
    }
  }
  return results;
}
