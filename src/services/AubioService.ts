import { execSync } from 'child_process';

/**
 * AubioService.ts
 *
 * Offline audio analysis for BPM and musical key using macOS CLI tools:
 * - 'aubio tempo' for BPM estimation.
 * - 'keyfinder-cli' for musical key detection (Camelot notation).
 */

/**
 * Estimates BPM of an audio file using 'aubio tempo' CLI.
 */
export function estimateBpm(filepath: string): number | undefined {
  try {
    const output = execSync(`aubio tempo "${filepath}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    });

    // Parse the output (typically "X.XXXXXX bpm" or just a number)
    const match = output.match(/(\d+(?:\.\d+)?)\s*bpm/i) || output.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      const bpm = parseFloat(match[1]);
      if (bpm > 40 && bpm < 250) {
        return Math.round(bpm);
      }
    }
  } catch {
    // CLI tool not installed or failed to run
  }
  return undefined;
}

/**
 * Detects the musical key using 'keyfinder-cli' (Camelot notation) if available.
 */
export function detectKey(filepath: string): string | undefined {
  try {
    // Run keyfinder-cli requesting Camelot notation output
    const output = execSync(`keyfinder-cli -n camelot "${filepath}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    });

    const key = output.trim();
    // Camelot key pattern: e.g. "8A", "11B", "02A"
    if (/^\d{1,2}[AB]$/i.test(key)) {
      return key.toUpperCase();
    }
  } catch {
    // keyfinder-cli not installed or failed to run
  }
  return undefined;
}
