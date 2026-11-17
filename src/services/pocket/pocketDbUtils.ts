/**
 * pocketDbUtils.ts
 *
 * Math and parsing utility functions for pure SQLite local vector & acoustic queries.
 * Strictly zero external AI/LLM network calls.
 */

export function cleanMetadataString(str: string): string {
  if (!str) return '';
  return str
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Converts a raw 2048-byte buffer to a 512-dim Float32Array.
 * Safely handles unaligned byte offsets and wraps instantiation in try/catch.
 */
export function bufferToFloat32Array(buf: Buffer | null | undefined): Float32Array | null {
  if (!buf || buf.length < 2048) return null;
  try {
    if (buf.byteOffset % 4 !== 0) {
      const aligned = Buffer.alloc(2048);
      buf.copy(aligned, 0, 0, 2048);
      return new Float32Array(aligned.buffer, aligned.byteOffset, 512);
    }
    return new Float32Array(buf.buffer, buf.byteOffset, 512);
  } catch {
    return null;
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < 512; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA <= 0 || normB <= 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function parseCamelot(
  keyStr: string | null | undefined
): { num: number; letter: 'A' | 'B' } | null {
  if (!keyStr) return null;
  const match = keyStr
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2})([AB])$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (num < 1 || num > 12) return null;
  return { num, letter: match[2] as 'A' | 'B' };
}

export function isCamelotCompatible(key1: string, key2: string): boolean {
  const k1 = parseCamelot(key1);
  const k2 = parseCamelot(key2);
  if (!k1 || !k2) return false;
  if (k1.num === k2.num && k1.letter === k2.letter) return true; // exact
  if (k1.num === k2.num) return true; // relative major/minor (e.g. 8A <-> 8B)
  if (k1.letter === k2.letter) {
    const diff = Math.abs(k1.num - k2.num);
    if (diff === 1 || diff === 11) return true; // adjacent on circle of 5ths (e.g. 8A <-> 7A, 12A <-> 1A)
  }
  return false;
}
