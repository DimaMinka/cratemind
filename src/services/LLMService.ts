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
  if (!aiClient) {
    // The GoogleGenAI client automatically retrieves GEMINI_API_KEY from process.env
    aiClient = new GoogleGenAI({});
  }
  return aiClient;
}

export async function classifyTrack(
  artist: string,
  title: string,
  ragContext = ''
): Promise<LLMResponse> {
  const contextHash = CacheService.generateContextHash(artist, title, ragContext);

  // 1. Check cache first
  const cachedResponse = CacheService.getTrackCache(artist, title, contextHash);
  if (cachedResponse) {
    return cachedResponse;
  }

  // 2. Check and increment limits
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

  // Real Gemini API Execution
  let attempts = 2;
  while (attempts > 0) {
    try {
      const ai = getAIClient();

      const systemInstruction = `You are CrateMind, an elite audio classification system designed to organize music libraries into atmospheric vibe-based folders ("crates").
Available vibes (crates):
${FOLDERS.map((f) => `- ${f}`).join('\n')}

Task:
Analyze the artist and track title. Utilize the provided Few-Shot RAG memory of already sorted tracks to align with the user's specific library style.
Classify the track into 1 to 3 folders.
Provide a clear, detailed, one-sentence reasoning.
Provide a confidence score (between 0.0 and 1.0). Set confidence lower than 0.70 if the track is highly ambiguous, cross-genre, or does not perfectly fit the vibes.

You MUST respond strictly with a valid JSON matching this schema:
{
  "folders": ["crate name 1", "crate name 2"],
  "reasoning": "A short, descriptive one-sentence analysis of the track vibes.",
  "confidence": 0.92
}`;

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
      attempts--;
      if (attempts === 0) {
        throw new Error('Gemini API classification failed after 2 attempts', { cause: err });
      }
      // Simple exponential backoff delay before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error('Unexpected execution flow in Gemini classifier');
}
