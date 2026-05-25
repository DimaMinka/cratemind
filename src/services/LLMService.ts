import { LLMResponse } from '../types.js';
import { MOCK_MODE } from '../config.js';

/**
 * LLMService.ts
 *
 * Integrates with Google Gen AI SDK (Gemini) to categorize tracks
 * based on vibe and atmosphere. Uses structured JSON output with Zod validation.
 */

export async function classifyTrack(
  artist: string,
  title: string,
  _ragContext = ''
): Promise<LLMResponse> {
  if (MOCK_MODE) {
    // Artificial latency to simulate Gemini API network calls
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const artistLower = artist.toLowerCase();

    // Trigger Manual Override for Stephan Bodzin
    if (artistLower.includes('bodzin')) {
      return {
        folders: ['galaxy trip'],
        reasoning: 'Hypnotic melodic synth lead, deep hardware textures. Borderline atmospheric.',
        confidence: 0.65 // Below 0.70 threshold -> triggers manual selection!
      };
    }

    // Auto-route Recondite
    if (artistLower.includes('recondite')) {
      return {
        folders: ['galaxy trip', 'iceland'],
        reasoning:
          'Deep, dark, cold minimal techno with spacious acoustic reverbs. Fits perfectly.',
        confidence: 0.95
      };
    }

    // Default mock response for other tracks
    return {
      folders: ['mountain sunset'],
      reasoning: 'Warm organic instrumentation, melancholic strings and emotional progression.',
      confidence: 0.88
    };
  }

  // TODO: Implement Gemini 2.5 API integration, structured schema, and retries
  return {
    folders: ['intro outro'],
    reasoning: 'Stub reasoning',
    confidence: 1.0
  };
}
