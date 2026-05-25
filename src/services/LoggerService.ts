import * as fs from 'fs';
import * as path from 'path';

/**
 * LoggerService.ts
 *
 * Handles file-based logging for CrateMind to ensure side-effects are kept
 * separate from the global state management.
 */

export function logToFile(type: string, message: string): void {
  try {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const logLine = `[${timestamp}] [${type}] ${message}\n`;
    fs.appendFileSync(path.resolve('./cratemind.log'), logLine);
  } catch {
    // Graceful fallback if log writing fails
  }
}
