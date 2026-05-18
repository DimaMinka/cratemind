import { LLMResponse } from '../types.js';

/**
 * LLMService.ts
 * Integrates with Google Gen AI SDK (Gemini) to categorize tracks
 * based on vibe and atmosphere. Uses structured JSON output with Zod validation.
 */

export async function classifyTrack(artist: string, title: string): Promise<LLMResponse> {
  // TODO: Implement Gemini 2.5 API integration, structured schema, and retries
  return {
    folders: ['intro outro'],
    reasoning: 'Stub reasoning',
    confidence: 1.0
  };
}
