import type { PocketTrackItem } from '../types/pocketWeb.types.js';

const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export class IosAudioEngine {
  private audio: HTMLAudioElement;
  private activeBlobUrl: string | null = null;
  private isUnlocked = false;
  private currentTrackDuration = 0;
  private nextCallback: (() => void) | null = null;
  private prevCallback: (() => void) | null = null;
  private endedCallback: (() => void) | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';

    this.audio.addEventListener('ended', () => {
      if (this.endedCallback) {
        this.endedCallback();
      }
    });

    this.audio.addEventListener('loadedmetadata', () => {
      this.updatePositionState();
    });

    this.audio.addEventListener('timeupdate', () => {
      this.updatePositionState();
    });

    this.setupMediaSession();
  }

  public getAudioElement(): HTMLAudioElement {
    return this.audio;
  }

  public async unlock(): Promise<boolean> {
    if (this.isUnlocked) return true;

    const existingSrc = this.audio.getAttribute('src') || this.audio.src;
    if (existingSrc) {
      // Preserve loaded track src so concurrent/subsequent play() unlocks directly in the gesture.
      this.isUnlocked = true;
      return true;
    }

    try {
      this.audio.src = SILENT_WAV_DATA_URI;
      await this.audio.play();
      this.audio.pause();
      this.audio.currentTime = 0;
      this.isUnlocked = true;
      return true;
    } catch {
      return false;
    } finally {
      if (this.audio.src === SILENT_WAV_DATA_URI) {
        this.audio.src = '';
        this.audio.removeAttribute('src');
      }
    }
  }

  private safeSetActionHandler(
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null
  ): void {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) {
      return;
    }
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Ignore unsupported MediaSessionAction on older WebKit versions
    }
  }

  private setupMediaSession(): void {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) {
      return;
    }

    this.safeSetActionHandler('play', () => {
      this.play().catch(() => {
        if (typeof navigator !== 'undefined' && navigator.mediaSession) {
          navigator.mediaSession.playbackState = 'paused';
        }
      });
    });

    this.safeSetActionHandler('pause', () => {
      this.pause();
    });

    this.safeSetActionHandler('nexttrack', () => {
      if (this.nextCallback) {
        this.nextCallback();
      }
    });

    this.safeSetActionHandler('previoustrack', () => {
      if (this.prevCallback) {
        this.prevCallback();
      }
    });

    this.safeSetActionHandler('seekbackward', (details) => {
      const skipTime = details?.seekOffset || 10;
      this.audio.currentTime = Math.max(0, this.audio.currentTime - skipTime);
      this.updatePositionState();
    });

    this.safeSetActionHandler('seekforward', (details) => {
      const skipTime = details?.seekOffset || 30;
      const duration = Number.isFinite(this.audio.duration)
        ? this.audio.duration
        : this.currentTrackDuration;
      if (Number.isFinite(duration) && duration > 0) {
        this.audio.currentTime = Math.min(duration, this.audio.currentTime + skipTime);
      } else {
        this.audio.currentTime += skipTime;
      }
      this.updatePositionState();
    });
  }

  public updatePositionState(): void {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaSession ||
      typeof navigator.mediaSession.setPositionState !== 'function'
    ) {
      return;
    }

    const rawDuration = this.audio.duration;
    const duration =
      Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : this.currentTrackDuration;
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

    const rawPosition = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
    const position = Math.max(0, Math.min(duration, rawPosition));
    const playbackRate =
      Number.isFinite(this.audio.playbackRate) && this.audio.playbackRate > 0
        ? this.audio.playbackRate
        : 1;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate,
        position
      });
    } catch {
      // Ignore invalid MediaPositionState errors
    }
  }

  public async loadTrack(track: PocketTrackItem, source?: Blob | string): Promise<void> {
    if (this.activeBlobUrl) {
      URL.revokeObjectURL(this.activeBlobUrl);
      this.activeBlobUrl = null;
    }

    this.currentTrackDuration =
      Number.isFinite(track.duration) && track.duration > 0 ? track.duration : 0;

    if (source instanceof Blob) {
      this.activeBlobUrl = URL.createObjectURL(source);
      this.audio.src = this.activeBlobUrl;
    } else if (typeof source === 'string' && source.length > 0) {
      this.audio.src = source;
    } else if (track.previewAudioUrl) {
      this.audio.src = track.previewAudioUrl;
    } else {
      this.audio.src = '';
      this.audio.removeAttribute('src');
    }

    this.audio.load();
    this.updateMediaMetadata(track);
    this.updatePositionState();
  }

  private updateMediaMetadata(track: PocketTrackItem): void {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) {
      return;
    }

    const tags: string[] = [];
    if (track.bpm) tags.push(`${track.bpm} BPM`);
    if (track.key) tags.push(track.key);

    const albumDetail = tags.length > 0 ? tags.join(' • ') : 'Manual Curation';
    const albumTitle = `CrateMind Pocket • ${albumDetail}`;

    if (typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || track.filename,
        artist: track.artist || 'Unknown Artist',
        album: albumTitle,
        artwork: [
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      });
    }
  }

  public async play(): Promise<boolean> {
    try {
      await this.audio.play();
      this.isUnlocked = true;
      if (typeof navigator !== 'undefined' && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'playing';
      }
      this.updatePositionState();
      return true;
    } catch (err) {
      this.isUnlocked = false;
      // Handle iOS autoplay / user gesture policy silently without throwing unhandled rejection
      console.warn('[IosAudioEngine] Playback prevented by browser policy:', err);
      return false;
    }
  }

  public pause(): void {
    this.audio.pause();
    if (typeof navigator !== 'undefined' && navigator.mediaSession) {
      navigator.mediaSession.playbackState = 'paused';
    }
    this.updatePositionState();
  }

  public onTrackEnded(callback: () => void): void {
    this.endedCallback = callback;
  }

  public onNext(callback: () => void): void {
    this.nextCallback = callback;
  }

  public onPrev(callback: () => void): void {
    this.prevCallback = callback;
  }

  public dispose(): void {
    this.pause();
    if (this.activeBlobUrl) {
      URL.revokeObjectURL(this.activeBlobUrl);
      this.activeBlobUrl = null;
    }
    this.audio.src = '';
    this.audio.removeAttribute('src');
    this.endedCallback = null;
    this.nextCallback = null;
    this.prevCallback = null;

    this.safeSetActionHandler('play', null);
    this.safeSetActionHandler('pause', null);
    this.safeSetActionHandler('nexttrack', null);
    this.safeSetActionHandler('previoustrack', null);
    this.safeSetActionHandler('seekbackward', null);
    this.safeSetActionHandler('seekforward', null);
  }
}
