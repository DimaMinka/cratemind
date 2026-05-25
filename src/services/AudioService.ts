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

export function previewAudio(filepath: string, offset = 0, duration = 180): void {
  const setPlayback = useStore.getState().setPlayback;
  const addLog = useStore.getState().addLog;
  const filename = path.basename(filepath);

  if (MOCK_MODE && !fs.existsSync(filepath)) {
    setPlayback({
      filepath,
      filename,
      duration,
      offset,
      lastStartedAt: Date.now()
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

    activeAudioProcess = spawn('ffplay', ['-nodisp', '-ss', String(offset), absolutePath], { stdio: 'ignore' });

    activeAudioProcess.on('error', (err) => {
      addLog('ERROR', `ffplay launch failed: ${err.message}`);
    });

    activeAudioProcess.on('exit', (code) => {
      if (code !== null && code !== 0 && code !== 15 && code !== 9) {
        addLog('ERROR', `ffplay exited with error code: ${code}`);
      }
      const currentPlayback = useStore.getState().playback;
      if (currentPlayback?.filepath === filepath && activeAudioProcess === null) {
        setPlayback(null);
      }
    });

    setPlayback({
      filepath,
      filename,
      duration,
      offset,
      lastStartedAt: Date.now()
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('ERROR', `Playback trigger failed: ${msg}`);
  }
}

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

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

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

  previewAudio(playback.filepath, newOffset, playback.duration);
}
