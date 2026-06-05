import * as fs from 'fs';
import * as path from 'path';

/**
 * LoggerService.ts
 *
 * Handles file-based logging for CrateMind to ensure side-effects are kept
 * separate from the global state management.
 * Includes size-based log rotation (5MB cap) to prevent infinite log growth.
 */

const LOG_FILE_PATH = path.resolve('./cratemind.log');
const OLD_LOG_FILE_PATH = path.resolve('./cratemind.old.log');
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function rotateLogsIfNeeded(): void {
  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      const stats = fs.statSync(LOG_FILE_PATH);
      if (stats.size >= MAX_LOG_SIZE_BYTES) {
        if (fs.existsSync(OLD_LOG_FILE_PATH)) {
          fs.unlinkSync(OLD_LOG_FILE_PATH);
        }
        fs.renameSync(LOG_FILE_PATH, OLD_LOG_FILE_PATH);
      }
    }
  } catch {
    // Ignore rotation errors to keep logger resilient
  }
}

export function logToFile(type: string, message: string): void {
  try {
    rotateLogsIfNeeded();
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const logLine = `[${timestamp}] [${type}] ${message}\n`;
    fs.appendFileSync(LOG_FILE_PATH, logLine);
  } catch {
    // Graceful fallback if log writing fails
  }
}
