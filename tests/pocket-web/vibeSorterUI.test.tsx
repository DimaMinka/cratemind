// @vitest-environment jsdom
import './setup.js';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { VibeSorterView } from '../../pocket-web/src/components/sorter/VibeSorterView.js';
import { FOLDERS } from '../../src/config.js';
import type { PocketTrackItem } from '../../pocket-web/src/types/pocketWeb.types.js';

describe('Tier 3: VibeSorterView (Tactile Pad Matrix, 450ms Route & Zero AI)', () => {
  const mockTrack: PocketTrackItem = {
    id: 'track-01',
    filename: '01 Dune Walk.mp3',
    title: 'Dune Walk',
    artist: 'Desert Nomad',
    duration: 220,
    bpm: 122,
    key: '8A',
    energyShape: [0.1, 0.3, 0.5, 0.7, 0.9, 1.0, 0.8, 0.9, 0.7, 0.4, 0.3, 0.5, 0.8, 0.9, 0.6, 0.3],
    ragSuggestions: [{ folder: 'desert vibe', similarity: 0.94, matchSource: 'clap' }],
    ytScout: {
      playlistName: 'Bedouin Chill Sessions',
      suggestedFolder: 'nargila vibe'
    }
  };

  const defaultProps = {
    currentTrack: mockTrack,
    trackIndex: 0,
    totalTracks: 30,
    selectedFolders: [] as string[],
    onToggleFolder: vi.fn(),
    onRouteInstant: vi.fn(),
    onSkipTrack: vi.fn()
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('21 Pad Grid Rendering', () => {
    it('TC-UI-01: renders all 21 crate pads corresponding to FOLDERS config', () => {
      const { container } = render(<VibeSorterView {...defaultProps} />);

      expect(FOLDERS).toHaveLength(21);
      for (const folderName of FOLDERS) {
        const padElement = screen.getByText(folderName);
        expect(padElement).toBeInTheDocument();
      }

      const pads = container.querySelectorAll('.dj-pad');
      expect(pads.length).toBe(21);
    });

    it('TC-UI-02: highlights RAG suggestions with RAG XX% badge and YT Scout match', () => {
      render(<VibeSorterView {...defaultProps} />);

      expect(screen.getByText('RAG 94%')).toBeInTheDocument();
      expect(screen.getByText('YT MATCH')).toBeInTheDocument();
    });

    it('TC-UI-03: verifies touch target minimum height class on all pads', () => {
      const { container } = render(<VibeSorterView {...defaultProps} />);
      const pads = container.querySelectorAll('.dj-pad');
      pads.forEach((pad) => {
        expect(pad.className).toContain('min-h-[54px]');
      });
    });
  });

  describe('Multi-Select Pad Tagging', () => {
    it('TC-UI-04: triggers onToggleFolder on standard click/tap', () => {
      render(<VibeSorterView {...defaultProps} />);
      const pad = screen.getByText('desert vibe');

      fireEvent.click(pad);
      expect(defaultProps.onToggleFolder).toHaveBeenCalledWith('desert vibe');
    });

    it('TC-UI-05: applies visual yellow highlight when pad is in selectedFolders', () => {
      const { container } = render(
        <VibeSorterView {...defaultProps} selectedFolders={['desert vibe', 'club party']} />
      );

      const activePad = container.querySelector('[data-folder="desert vibe"]');
      expect(activePad?.className).toContain('glow-yellow-active');
    });
  });

  describe('450ms Long-Press for 1-Tap Route', () => {
    it('TC-UI-06: does not trigger 1-tap route on short click (< 450ms)', () => {
      render(<VibeSorterView {...defaultProps} />);
      const pad = screen.getByText('magic forest');

      act(() => {
        fireEvent.pointerDown(pad, { clientX: 100, clientY: 100 });
        vi.advanceTimersByTime(250);
        fireEvent.pointerUp(pad);
      });

      expect(defaultProps.onRouteInstant).not.toHaveBeenCalled();
    });

    it('TC-UI-07: triggers 1-tap route on holding pad for >= 450ms and triggers haptics', () => {
      render(<VibeSorterView {...defaultProps} />);
      const pad = screen.getByText('magic forest');

      act(() => {
        fireEvent.pointerDown(pad, { clientX: 100, clientY: 100 });
        vi.advanceTimersByTime(450);
      });

      expect(defaultProps.onRouteInstant).toHaveBeenCalledWith('magic forest');
      expect(navigator.vibrate).toHaveBeenCalledWith(50);
    });

    it('TC-UI-08: cancels 1-tap route if pointer moves more than 10px during hold', () => {
      render(<VibeSorterView {...defaultProps} />);
      const pad = screen.getByText('magic forest');

      act(() => {
        fireEvent.pointerDown(pad, { clientX: 100, clientY: 100 });
        vi.advanceTimersByTime(200);
        fireEvent.pointerMove(pad, { clientX: 125, clientY: 100 });
        vi.advanceTimersByTime(300);
        fireEvent.pointerUp(pad);
      });

      expect(defaultProps.onRouteInstant).not.toHaveBeenCalled();
    });

    it('TC-UI-09: cancels 1-tap route on pointer cancel before 450ms', () => {
      render(<VibeSorterView {...defaultProps} />);
      const pad = screen.getByText('magic forest');

      act(() => {
        fireEvent.pointerDown(pad, { clientX: 100, clientY: 100 });
        vi.advanceTimersByTime(200);
        fireEvent.pointerCancel(pad);
        vi.advanceTimersByTime(300);
      });

      expect(defaultProps.onRouteInstant).not.toHaveBeenCalled();
    });
  });

  describe('Strict Zero "AI" / "Gemini" Copy Policy', () => {
    it('TC-UI-10: contains zero occurrences of "AI", "Gemini", or "LLM" in rendered text and HTML', () => {
      const { container } = render(<VibeSorterView {...defaultProps} />);

      const visibleText = container.textContent || '';
      expect(visibleText).not.toMatch(/\b(AI|Gemini|LLM)\b/i);
      expect(container.innerHTML).not.toMatch(/\b(Gemini|LLM)\b/i);
    });

    it('TC-UI-11: uses strictly audio engineering and crate curation labels', () => {
      render(<VibeSorterView {...defaultProps} />);

      expect(screen.getByText('★ CRATEMIND POCKET')).toBeInTheDocument();
      expect(screen.getByText('122 BPM')).toBeInTheDocument();
      expect(screen.getByText('8A')).toBeInTheDocument();
      expect(screen.getByText('RAG 94%')).toBeInTheDocument();
      expect(screen.getByText('YT MATCH')).toBeInTheDocument();
    });
  });

  describe('Gesture & Controls', () => {
    it('TC-UI-12: triggers onSkipTrack on skip click and supports DJ play button gestures (tap, double-tap -30s, hold +10s)', () => {
      const onTogglePlay = vi.fn();
      const onSeekBackward = vi.fn();
      const onSeekForward = vi.fn();
      render(
        <VibeSorterView
          {...defaultProps}
          onTogglePlay={onTogglePlay}
          onSeekBackward={onSeekBackward}
          onSeekForward={onSeekForward}
        />
      );

      // Duration badge rendered alongside BPM
      expect(screen.getByText('03:40')).toBeInTheDocument();

      const skipBtn = screen.getByText('SKIP');
      fireEvent.click(skipBtn);
      expect(defaultProps.onSkipTrack).toHaveBeenCalledTimes(1);

      const playBtn = screen.getByLabelText('Play');

      // Single tap -> toggle play after double-tap window
      act(() => {
        fireEvent.pointerDown(playBtn, { button: 0, pointerType: 'touch' });
        fireEvent.pointerUp(playBtn);
        vi.advanceTimersByTime(300);
      });
      expect(onTogglePlay).toHaveBeenCalledTimes(1);
      expect(onSeekBackward).not.toHaveBeenCalled();

      // Double tap -> seek backward 30s without toggling play
      act(() => {
        fireEvent.pointerDown(playBtn, { button: 0, pointerType: 'touch' });
        fireEvent.pointerUp(playBtn);
        vi.advanceTimersByTime(100);
        fireEvent.pointerDown(playBtn, { button: 0, pointerType: 'touch' });
        fireEvent.pointerUp(playBtn);
        vi.advanceTimersByTime(300);
      });
      expect(onSeekBackward).toHaveBeenCalledTimes(1);
      expect(onTogglePlay).toHaveBeenCalledTimes(1);

      // Hold -> seek forward 10s repeatedly while held, no toggle play on release
      act(() => {
        fireEvent.pointerDown(playBtn, { button: 0, pointerType: 'touch' });
        vi.advanceTimersByTime(350);
        vi.advanceTimersByTime(350);
        fireEvent.pointerUp(playBtn);
        vi.advanceTimersByTime(300);
      });
      expect(onSeekForward).toHaveBeenCalledTimes(2);
      expect(onTogglePlay).toHaveBeenCalledTimes(1);
    });

    it('TC-UI-13: releasing pointer after 450ms long press suppresses click and does not trigger onToggleFolder', () => {
      const onToggleFolder = vi.fn();
      const onRouteInstant = vi.fn();
      render(
        <VibeSorterView
          {...defaultProps}
          onToggleFolder={onToggleFolder}
          onRouteInstant={onRouteInstant}
        />
      );
      const pad = screen.getByText('magic forest');

      act(() => {
        fireEvent.pointerDown(pad, { clientX: 100, clientY: 100 });
        vi.advanceTimersByTime(450);
        fireEvent.pointerUp(pad);
        fireEvent.click(pad);
      });

      expect(onRouteInstant).toHaveBeenCalledWith('magic forest');
      expect(onToggleFolder).not.toHaveBeenCalled();
    });

    it('TC-UI-14: triggers onSkipTrack on swipe left gesture (> 40px leftward)', () => {
      const onSkipTrack = vi.fn();
      render(<VibeSorterView {...defaultProps} onSkipTrack={onSkipTrack} />);

      act(() => {
        const startTouch = { clientX: 300, clientY: 400 };
        const endTouch = { clientX: 240, clientY: 400 };
        window.dispatchEvent(
          new TouchEvent('touchstart', { touches: [startTouch as unknown as Touch], bubbles: true })
        );
        window.dispatchEvent(
          new TouchEvent('touchend', {
            touches: [],
            changedTouches: [endTouch as unknown as Touch],
            bubbles: true
          })
        );
      });

      expect(onSkipTrack).toHaveBeenCalledTimes(1);
    });
  });
});
