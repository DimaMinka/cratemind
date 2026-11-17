// @vitest-environment jsdom
import './setup.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IosAudioEngine } from '../../pocket-web/src/audio/iosAudioEngine.js';
import { mockMediaSessionActions } from './setup.js';
import type { PocketTrackItem } from '../../pocket-web/src/types/pocketWeb.types.js';

describe('Tier 3: iosAudioEngine (Persistent Audio & iOS Lockscreen)', () => {
  let engine: IosAudioEngine;
  const mockTrack1: PocketTrackItem = {
    id: 'track-1',
    filename: '01 Solaris.mp3',
    title: 'Solaris',
    artist: 'Photek',
    duration: 360,
    bpm: 174,
    key: '4A'
  };
  const mockTrack2: PocketTrackItem = {
    id: 'track-2',
    filename: '02 Watercolours.mp3',
    title: 'Watercolours',
    artist: 'LTJ Bukem',
    duration: 420,
    bpm: 168,
    key: '9B'
  };

  beforeEach(() => {
    engine = new IosAudioEngine();
  });

  afterEach(() => {
    engine.dispose();
  });

  describe('Single Persistent Audio Element Reuse', () => {
    it('TC-AE-01: instantiates and reuses a single HTMLAudioElement instance across track transitions', async () => {
      const initialAudioElement = engine.getAudioElement();
      expect(initialAudioElement).toBeInstanceOf(HTMLAudioElement);

      const blob1 = new Blob(['audio1'], { type: 'audio/aac' });
      const blob2 = new Blob(['audio2'], { type: 'audio/aac' });

      await engine.loadTrack(mockTrack1, blob1);
      expect(engine.getAudioElement()).toBe(initialAudioElement);

      await engine.loadTrack(mockTrack2, blob2);
      expect(engine.getAudioElement()).toBe(initialAudioElement);

      for (let i = 0; i < 5; i++) {
        await engine.loadTrack(mockTrack1, blob1);
        expect(engine.getAudioElement()).toBe(initialAudioElement);
      }
    });

    it('TC-AE-02: maintains exact same instance identity across 10 sequential track advances', async () => {
      const initialAudio = engine.getAudioElement();
      for (let i = 0; i < 10; i++) {
        const dummyTrack: PocketTrackItem = {
          id: `track-${i}`,
          filename: `track_${i}.mp3`,
          title: `Track ${i}`,
          artist: `Artist ${i}`,
          duration: 200
        };
        const blob = new Blob([`audio-${i}`], { type: 'audio/aac' });
        await engine.loadTrack(dummyTrack, blob);
        expect(engine.getAudioElement()).toBe(initialAudio);
      }
    });

    it('TC-AE-03: does not append extra audio elements to DOM', async () => {
      const blob = new Blob(['data'], { type: 'audio/aac' });
      await engine.loadTrack(mockTrack1, blob);
      await engine.loadTrack(mockTrack2, blob);

      const audioElements = document.querySelectorAll('audio');
      expect(audioElements.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Blob URL Cleanup & Revocation', () => {
    it('TC-AE-04: creates object URL on track load and revokes previous URL on next track', async () => {
      const blob1 = new Blob(['audio1'], { type: 'audio/aac' });
      const blob2 = new Blob(['audio2'], { type: 'audio/aac' });

      await engine.loadTrack(mockTrack1, blob1);
      expect(URL.createObjectURL).toHaveBeenCalledWith(blob1);
      const firstUrl = (vi.mocked(URL.createObjectURL).mock.results[0] as { value: string }).value;

      await engine.loadTrack(mockTrack2, blob2);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
      expect(URL.createObjectURL).toHaveBeenCalledWith(blob2);
    });

    it('TC-AE-05: revokes active blob URL on engine disposal', async () => {
      const blob = new Blob(['audio'], { type: 'audio/aac' });
      await engine.loadTrack(mockTrack1, blob);
      const activeUrl = (vi.mocked(URL.createObjectURL).mock.results[0] as { value: string }).value;

      engine.dispose();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(activeUrl);
    });
  });

  describe('Lockscreen navigator.mediaSession Integration', () => {
    it('TC-AE-06: sets MediaMetadata with title, artist, and formatted album metadata', async () => {
      const blob = new Blob(['audio'], { type: 'audio/aac' });
      await engine.loadTrack(mockTrack1, blob);

      const metadata = navigator.mediaSession.metadata;
      expect(metadata).not.toBeNull();
      expect(metadata?.title).toBe('Solaris');
      expect(metadata?.artist).toBe('Photek');
      expect(metadata?.album).toContain('174 BPM');
      expect(metadata?.album).toContain('4A');
    });

    it('TC-AE-07: updates mediaSession.playbackState on play and pause', async () => {
      const blob = new Blob(['audio'], { type: 'audio/aac' });
      await engine.loadTrack(mockTrack1, blob);

      await engine.play();
      expect(navigator.mediaSession.playbackState).toBe('playing');

      engine.pause();
      expect(navigator.mediaSession.playbackState).toBe('paused');
    });

    it('TC-AE-08: registers mediaSession action handlers for lockscreen hardware controls', () => {
      expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledWith(
        'play',
        expect.any(Function)
      );
      expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledWith(
        'pause',
        expect.any(Function)
      );
      expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledWith(
        'nexttrack',
        expect.any(Function)
      );
      expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledWith(
        'previoustrack',
        expect.any(Function)
      );
      expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledWith(
        'seekbackward',
        expect.any(Function)
      );
      expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledWith(
        'seekforward',
        expect.any(Function)
      );
    });

    it('TC-AE-09: executes -10s seekbackward and clamps to 0', async () => {
      const audio = engine.getAudioElement();
      audio.currentTime = 25;

      const seekBackwardHandler = mockMediaSessionActions.get('seekbackward');
      expect(seekBackwardHandler).toBeDefined();
      seekBackwardHandler!();
      expect(audio.currentTime).toBe(15);

      audio.currentTime = 4;
      seekBackwardHandler!();
      expect(audio.currentTime).toBe(0);
    });

    it('TC-AE-10: executes +30s seekforward and clamps to track duration', async () => {
      const audio = engine.getAudioElement();
      Object.defineProperty(audio, 'duration', { value: 180, configurable: true });
      audio.currentTime = 50;

      const seekForwardHandler = mockMediaSessionActions.get('seekforward');
      expect(seekForwardHandler).toBeDefined();
      seekForwardHandler!();
      expect(audio.currentTime).toBe(80);

      audio.currentTime = 165;
      seekForwardHandler!();
      expect(audio.currentTime).toBe(180);
    });
  });

  describe('Event Callbacks & Navigation', () => {
    it('TC-AE-11: triggers onTrackEnded callback when audio fires "ended" event', async () => {
      const onEnded = vi.fn();
      engine.onTrackEnded(onEnded);

      const audio = engine.getAudioElement();
      audio.dispatchEvent(new Event('ended'));

      expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it('TC-AE-12: routes hardware nexttrack and previoustrack to registered callbacks', async () => {
      const onNext = vi.fn();
      const onPrev = vi.fn();
      engine.onNext(onNext);
      engine.onPrev(onPrev);

      const nextHandler = mockMediaSessionActions.get('nexttrack');
      const prevHandler = mockMediaSessionActions.get('previoustrack');

      expect(nextHandler).toBeDefined();
      expect(prevHandler).toBeDefined();

      nextHandler!();
      expect(onNext).toHaveBeenCalledTimes(1);

      prevHandler!();
      expect(onPrev).toHaveBeenCalledTimes(1);
    });
  });

  describe('Robustness & Error Guards', () => {
    it('TC-AE-13: unlock() preserves already-loaded track src', async () => {
      const blob = new Blob(['audio1'], { type: 'audio/aac' });
      await engine.loadTrack(mockTrack1, blob);
      const loadedSrc = engine.getAudioElement().src;
      expect(loadedSrc).toContain('blob:');

      const unlocked = await engine.unlock();
      expect(unlocked).toBe(true);
      expect(engine.getAudioElement().src).toBe(loadedSrc);
    });

    it('TC-AE-14: loadTrack() clears audio.src when next track has no audio source', async () => {
      const blob = new Blob(['audio1'], { type: 'audio/aac' });
      await engine.loadTrack(mockTrack1, blob);
      expect(engine.getAudioElement().src).toContain('blob:');

      await engine.loadTrack(mockTrack2);
      expect(engine.getAudioElement().getAttribute('src')).toBeNull();
    });

    it('TC-AE-15: updates navigator.mediaSession.setPositionState during playback and seek', async () => {
      const blob = new Blob(['audio1'], { type: 'audio/aac' });
      await engine.loadTrack(mockTrack1, blob);
      const audio = engine.getAudioElement();
      Object.defineProperty(audio, 'duration', { value: 360, configurable: true });
      audio.currentTime = 45;

      await engine.play();
      expect(navigator.mediaSession.setPositionState).toHaveBeenCalledWith({
        duration: 360,
        playbackRate: 1,
        position: 45
      });

      const seekForwardHandler = mockMediaSessionActions.get('seekforward');
      seekForwardHandler?.();
      expect(navigator.mediaSession.setPositionState).toHaveBeenLastCalledWith({
        duration: 360,
        playbackRate: 1,
        position: 75
      });
    });

    it('TC-AE-16: mediaSession play handler catches rejected audio.play() without unhandled rejection', async () => {
      const audio = engine.getAudioElement();
      vi.spyOn(audio, 'play').mockRejectedValueOnce(new Error('NotAllowedError'));

      const playHandler = mockMediaSessionActions.get('play');
      expect(playHandler).toBeDefined();
      expect(() => playHandler!()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(navigator.mediaSession.playbackState).toBe('paused');
    });

    it('TC-AE-17: safely guards unsupported MediaSession actions during construction and disposal', () => {
      const origSetActionHandler = navigator.mediaSession.setActionHandler;
      navigator.mediaSession.setActionHandler = vi.fn((action: MediaSessionAction) => {
        if (action === 'seekbackward') {
          throw new TypeError('Unsupported action');
        }
      });

      const resilientEngine = new IosAudioEngine();
      expect(() => resilientEngine.dispose()).not.toThrow();
      navigator.mediaSession.setActionHandler = origSetActionHandler;
    });
  });
});
