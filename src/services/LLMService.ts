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
function formatVectorNeighborsContext(neighbors: VectorNeighbor[]): string {
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
Task: Analyze track metadata (BPM, Key, Genre, Label, Spotify features) + Few-Shot RAG memory. Return 1-2 matching crates based on sonic architecture.

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
- desert vibe: Dusty, spacious, dry atmospheres.
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

Feature Logic:
- Spotify Energy: >0.75 -> club party, psy, peak-time mountain sunset. <0.40 -> nargila vibe, mantra, iceland.
- Spotify Acousticness: >0.60 -> earth, magic forest. <0.25 -> galaxy trip, club party, robotic.
- Spotify Valence: >0.60 -> new day vibe, beach party, retro. <0.30 -> iceland, nargila vibe, mountain sunset.
- BPM & Key: >135 BPM -> psy, drum 'n' bass. Minor keys (e.g., 08A) -> dark/reflective. Major (e.g., 08B) -> bright/uplifting.

Priority Heuristics:
1. Driving Peak-Time / Club Grooves: If a track is energetic Melodic Techno, Progressive House, or Deep House (e.g., by Colyn, Innellea, Binaryh, Deviu, or club-focused Still.i/Eli & Fur tracks like 'Back To U') with robust, rolling bass structures and strong beat drive (or Spotify energy > 0.65), route it to 'club party'. The physical club groove overrides 'mountain sunset' or 'nargila vibe' unless the track is purely cinematic/ambient or lacks a heavy dancefloor drive.
2. Melodic House / Subdued Warm Melancholia: If a track has warm, nightly, non-intrusive, soft, or melancholic progressive/deep vibes (e.g., Eli & Fur, Still.i, Hunter/Game, or soft/chilled remixes like Kuriose Naturale - Alaz (Innellea Remix)) suitable as a supportive conversation background, route it to 'nargila vibe' instead of 'mountain sunset' or 'new day vibe'. Even if there are driving elements, if the vocal or atmosphere has a warm nightly melancholic vibe, prioritize 'nargila vibe'.
3. Dreamy / Nature Shimmer: Dreamy, melodic, shimmering progressive/deep house (e.g., Jody Wisternoff, James Grant, PROFF, or classic Anjunadeep sounds) with organic, acoustic, or forest-mysticism melodies routes to 'magic forest'.
4. Sunny / Water Sets: Carefree, sunny, summer/beach house vibes with warm uplifting chords (e.g., Sam Shure) route to 'beach party'.
5. Spacey Synths / Sci-Fi: Floating spacey leads, sci-fi modular soundscapes, or cosmic journeys (e.g., Recondite, ENØS, Petar Dundov remixes) route to 'galaxy trip'. Note: Tracks by ENØS, Woo York, Colyn, Fideles, Innellea, or other Afterlife-style artists that feature sweeping, dramatic, or majestic melodies with developmental energy should be classified primarily as 'mountain sunset' (or 'mountain sunset' + 'club party'), even if spacey modular synths are present, unless they are purely functional or lack melodic narrative.
6. Sunrise / Positive Uplift: Bright, early-morning, positive, hopeful chords or light melodic techno with a sunrise feel (e.g., Clawz SG, Deviu, or Themba's warm uplifting remixes) route to 'new day vibe'. If a track has bright, optimistic, early-morning sunrise elements, this overrides 'tropical vibe' or 'nargila vibe'.
7. Afro/Organic Percussion / Beach Grooves: Warm, Latin, celebratory Afro House or Organic House with prominent percussive patterns (e.g. Eli & Fur - Mirage, Themba) should route to 'tropical vibe', unless there is a dominant bright uplifting sunrise progression that overrides it to 'new day vibe'.
8. Presence of funky, disco, or old analog/vintage synth elements, indie dance, or oldschool house/disco vibes (like Voon - Good) -> 'retro' (regardless of the artist's usual deep/dark reputation or how modern the production feels).

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
  vectorNeighbors: VectorNeighbor[] = []
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
    vectorContext
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

${physicalContext ? physicalContext + '\n' : ''}${spotifyContext ? spotifyContext + '\n' : ''}${vectorContext ? '\n' + vectorContext + '\n' : ''}
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
