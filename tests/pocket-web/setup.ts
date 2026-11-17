import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// 0. Ensure native Node Blob is used in JSDOM so structuredClone inside fake-indexeddb preserves Blobs
globalThis.Blob = NodeBlob as unknown as typeof Blob;
if (typeof window !== 'undefined') {
  window.Blob = NodeBlob as unknown as typeof Blob;
}

// 1. Mock window.URL Blob methods with call tracking
let blobCounter = 0;
export const mockCreateObjectURL = vi.fn((_blob: Blob) => `blob:mock-url-${++blobCounter}`);
export const mockRevokeObjectURL = vi.fn();

if (typeof window !== 'undefined') {
  window.URL.createObjectURL = mockCreateObjectURL;
  window.URL.revokeObjectURL = mockRevokeObjectURL;
}
globalThis.URL.createObjectURL = mockCreateObjectURL;
globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

// 2. Mock HTMLMediaElement playback prototypes
if (typeof window !== 'undefined' && window.HTMLMediaElement) {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
}

// 3. Mock navigator.storage
if (typeof navigator !== 'undefined' && !navigator.storage) {
  Object.defineProperty(navigator, 'storage', {
    value: {
      persist: vi.fn().mockResolvedValue(true),
      persisted: vi.fn().mockResolvedValue(true),
      estimate: vi.fn().mockResolvedValue({
        quota: 1024 * 1024 * 1024,
        usage: 1024 * 1024 * 250
      })
    },
    configurable: true,
    writable: true
  });
}

// 4. Mock MediaMetadata and navigator.mediaSession
export interface MockMediaMetadataInit {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: Array<{ src: string; sizes: string; type: string }>;
}

export class MockMediaMetadata {
  title: string;
  artist: string;
  album: string;
  artwork: Array<{ src: string; sizes: string; type: string }>;

  constructor(init: MockMediaMetadataInit = {}) {
    this.title = init.title || '';
    this.artist = init.artist || '';
    this.album = init.album || '';
    this.artwork = init.artwork || [];
  }
}

(globalThis as unknown as { MediaMetadata: typeof MockMediaMetadata }).MediaMetadata =
  MockMediaMetadata;

export const mockMediaSessionActions = new Map<string, (...args: unknown[]) => void>();

if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'mediaSession', {
    value: {
      metadata: null,
      playbackState: 'none',
      setActionHandler: vi.fn((action: string, handler: ((...args: unknown[]) => void) | null) => {
        if (handler) {
          mockMediaSessionActions.set(action, handler);
        } else {
          mockMediaSessionActions.delete(action);
        }
      }),
      setPositionState: vi.fn()
    },
    configurable: true,
    writable: true
  });

  // 5. Mock navigator.vibrate
  if (!navigator.vibrate) {
    navigator.vibrate = vi.fn().mockReturnValue(true);
  }
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockMediaSessionActions.clear();
});
