import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { useStore } from './UIService.js';
import { MOCK_MODE } from '../config.js';

/**
 * AudioService.ts
 *
 * Manages background audio playback using macOS native 'ffplay' (or 'afplay').
 */

let activeAudioProcess: ChildProcess | null = null;

/**
 * Initiates audio playback of a track file as a background preview process using 'ffplay'.
 * Updates the global playback state with metadata and offsets.
 *
 * @param {string} filepath - Path to the audio file to be previewed.
 * @param {number} [offset=0] - Playback start time offset in seconds.
 * @param {number} [duration=180] - Total track duration in seconds.
 */
export function previewAudio(
  filepath: string,
  offset = 0,
  duration = 180,
  bpm?: number,
  key?: string
): void {
  const setPlayback = useStore.getState().setPlayback;
  const addLog = useStore.getState().addLog;
  const filename = path.basename(filepath);

  if (MOCK_MODE && !fs.existsSync(filepath)) {
    setPlayback({
      filepath,
      filename,
      duration,
      offset,
      lastStartedAt: Date.now(),
      bpm,
      key
    });
    return;
  }

  try {
    stopAudio();

    const absolutePath = path.resolve(filepath);

    if (fs.existsSync(absolutePath)) {
      const stats = fs.statSync(absolutePath);
      if (stats.size === 0) {
        addLog('ERROR', `Skipping audio preview: file is empty (0 bytes)`);
        return;
      }
    }

    activeAudioProcess = spawn('ffplay', ['-nodisp', '-ss', String(offset), absolutePath], {
      stdio: 'ignore'
    });

    activeAudioProcess.on('error', (err) => {
      addLog('ERROR', `ffplay launch failed: ${err.message}`);
    });

    activeAudioProcess.on('exit', (code) => {
      if (code !== null && code !== 0 && code !== 15 && code !== 9) {
        addLog('ERROR', `ffplay exited with error code: ${code}`);
      }
      const currentPlayback = useStore.getState().playback;
      if (
        currentPlayback?.filepath === filepath &&
        activeAudioProcess === null &&
        !currentPlayback.isPaused
      ) {
        setPlayback(null);
      }
    });

    setPlayback({
      filepath,
      filename,
      duration,
      offset,
      lastStartedAt: Date.now(),
      bpm,
      key
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('ERROR', `Playback trigger failed: ${msg}`);
  }
}

/**
 * Stops the currently active preview audio process ('ffplay') and resets the playback state.
 */
export function stopAudio(): void {
  const setPlayback = useStore.getState().setPlayback;
  setPlayback(null);

  if (activeAudioProcess) {
    try {
      activeAudioProcess.kill('SIGKILL');
    } catch {
      // Ignore process kill issues
    }
    activeAudioProcess = null;
  }
}

/**
 * Toggles the playback state between playing and paused for the active track preview.
 * Remembers the exact playback offset and resumes seamlessly.
 */
export function togglePausePreview(): void {
  const playback = useStore.getState().playback;
  const setPlayback = useStore.getState().setPlayback;
  if (!playback) return;

  if (activeAudioProcess) {
    // Currently playing -> Pause it
    const elapsed = Math.round((Date.now() - playback.lastStartedAt) / 1000);
    const newOffset = playback.offset + elapsed;

    // Set state to isPaused = true before killing the process
    setPlayback({
      ...playback,
      offset: newOffset,
      isPaused: true
    });

    try {
      activeAudioProcess.kill('SIGKILL');
    } catch {
      // Ignore process kill issues
    }
    activeAudioProcess = null;
  } else {
    // Currently paused -> Resume it
    setPlayback({
      ...playback,
      isPaused: false,
      lastStartedAt: Date.now()
    });
    previewAudio(playback.filepath, playback.offset, playback.duration, playback.bpm, playback.key);
  }
}

/**
 * Formats a duration in seconds into a standard 'MM:SS' string.
 *
 * @param {number} seconds - Total number of seconds.
 * @returns {string} Formatted time string (e.g. '3:05').
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Seeks the active preview audio playback by a relative offset (positive or negative).
 * Automatically handles bounds constraints and restarts ffplay with the new offset.
 *
 * @param {number} deltaSeconds - Time delta to seek (e.g. -10 or +10 seconds).
 */
export function seekPlayback(deltaSeconds: number): void {
  const playback = useStore.getState().playback;
  if (!playback) return;

  const elapsed = Math.round((Date.now() - playback.lastStartedAt) / 1000);
  let newOffset = playback.offset + elapsed + deltaSeconds;

  if (newOffset < 0) {
    newOffset = 0;
  }
  if (newOffset > playback.duration) {
    newOffset = playback.duration - 2;
  }

  previewAudio(playback.filepath, newOffset, playback.duration, playback.bpm, playback.key);
}
