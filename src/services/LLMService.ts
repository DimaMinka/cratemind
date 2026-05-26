import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import { LLMResponse } from '../types.js';
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

export async function classifyTrack(
  artist: string,
  title: string,
  ragContext = '',
  personalHints = ''
): Promise<LLMResponse> {
  const contextHash = CacheService.generateContextHash(artist, title, ragContext, personalHints);

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

      const systemInstruction = `You are CrateMind, an elite audio classification system designed to organize music libraries into atmospheric, vibe-based folders ("crates") rather than traditional, generic genres.

Task:
Analyze the artist and track title. Propose 1 to 2 folders (crates) for the track based on its musical character, texture, and physical sonic architecture. Utilize the provided Few-Shot RAG memory of already sorted tracks to align with the user's specific library style.

Step-by-Step Analysis (Perform this mental process before outputting):
1. Conceptual Markers: Assess the track name and label background. The artist's usual branding MUST NOT override the physical sound. If an Afterlife artist produces an Italo-disco or retro-groove track, give absolute priority to the actual acoustic character of the sound.
2. Synthetic Syntax: Identify the signature textures:
   - Floating cosmic leads with long reverb tails -> 'galaxy trip'
   - Earthy wooden plucks, bells, organic elements -> 'magic forest'
   - Fat analog Moog-like basslines -> 'retro'
3. Energy & Texture Balance: Evaluate the groove stiffness versus bass density. Distinguish empty dry white noise/suspense from a deep, atmospheric, cold minimalist trip.

Available atmospheric folders (crates):
- mountain sunset: Majestic, cinematic, developmental (melodic sunsets to peak-time drive). High-drama moments (e.g., iconic Afterlife sound). Never generic background music.
- magic forest: Nature mysticism, simplicity, sense of wonder. Up-tempo but without high drama. Includes tight club grooves accompanied by shimmering, organic, or acoustic melodies.
- nargila vibe: Warm, non-intrusive, supportive. Warm nightly melancholia. Perfect background for conversations.
- club party: Energetic, driving club grooves with robust bass structures.
- new day vibe: Bright, positive, inspiring, morning sunrise energy.
- tropical vibe: Warm, Latin, celebratory, Afro/Organic House. Prominent percussion patterns (takes priority even if synths are aggressive).
- beach party: Carefree, sunny, summer vibes, combined with strong danceable energy for daytime/sunset sets by the water.
- earth: Ethnic roots, organic instrumentation, raw vocals with character. The smell of roots.
- iceland: Cold, northern, restrained. Monochrome deep minimalism. Dark, frozen, slow drones without bright colorful synths (frozen lava effect).
- desert vibe: Dusty, spacious, dry, shimmering heat.
- spain vibe: Spanish passion, flamenco structures, fiery energy.
- india jungle: Eastern elements, deep jungle spices, dense and alive.
- galaxy trip: Space exploration, endless, psychedelic. Floating cosmic leads, sci-fi sound effects, dark space abysses.
- psy: Psychedelic, trance, deep mental trips.
- epic: Monumental, cinematic orchestral themes, heroic scale.
- mantra: Meditative, repetitive, spiritual, chanting.
- drum 'n' bass: Fast urban breaks, high tempo, city drive.
- retro: Nostalgia, vintage production. Funky basslines, disco vibes, oldschool house, Italo-disco.
- robotic: Mechanical, industrial, cold, non-human precision.
- rock: Guitars, raw human energy, acoustic band dynamics.
- intro outro: Transitions, functional tracks. Flat, dry, structural suspense or noise without melodic structure or deep atmospheric trip, used purely for technical mixing.

Routing Heuristics:
- Shimmering nature/acoustic vibe -> 'magic forest' or 'tropical vibe'.
- Grand developmental energy -> 'mountain sunset'.
- Warm nightly background -> 'nargila vibe'.
- Afro/Organic percussion beats over synth moods -> 'tropical vibe'.
- Aggressive, heavy drive and floor-shaking bassline -> 'club party'.
- Tight club drive + spacey leads/sci-fi theme -> 'club party' + 'galaxy trip'.
- Dynamic dance energy + mystical organic instrumentation -> 'club party' + 'magic forest'.
- Cold, sparse minimal without vivid synths -> 'galaxy trip' + 'iceland'.
- Presence of funky, disco, or old analog synth elements -> 'retro' (regardless of the artist's usual deep/dark reputation).

Output Instructions:
Select 1 to 3 folders (crates) from the list above.
Provide a confidence score (between 0.0 and 1.0). Set it below 0.70 if the track is highly ambiguous or cross-genre.
Provide a single, powerful, highly specific sentence explaining your reasoning.

You MUST respond strictly with a valid JSON matching this schema:
{
  "folders": ["crate name 1", "crate name 2"],
  "reasoning": "A short, descriptive one-sentence analysis of the track vibes.",
  "confidence": 0.92
}
${personalHints ? '\n' + personalHints : ''}`;

      const promptText = `Artist: ${artist}
Title: ${title}

${ragContext}`;

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
