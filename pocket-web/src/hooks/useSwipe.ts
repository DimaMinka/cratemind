import React, { useRef, useEffect, useCallback } from 'react';

export interface SwipeConfig {
  thresholdX?: number;
  thresholdY?: number;
  maxDurationMs?: number;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeMove?: (deltaX: number, deltaY: number) => void;
}

export interface SwipeHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchCancel: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

interface TouchSession {
  startX: number;
  startY: number;
  startTime: number;
}

export function useSwipe(config: SwipeConfig): SwipeHandlers {
  const {
    thresholdX = 60,
    thresholdY = 40,
    maxDurationMs = 400,
    onSwipeLeft,
    onSwipeRight,
    onSwipeMove
  } = config;

  const sessionRef = useRef<TouchSession | null>(null);

  const start = useCallback((x: number, y: number) => {
    sessionRef.current = {
      startX: x,
      startY: y,
      startTime: Date.now()
    };
  }, []);

  const move = useCallback(
    (x: number, y: number) => {
      if (!sessionRef.current) return;
      const deltaX = x - sessionRef.current.startX;
      const deltaY = y - sessionRef.current.startY;
      if (onSwipeMove) {
        onSwipeMove(deltaX, deltaY);
      }
    },
    [onSwipeMove]
  );

  const end = useCallback(
    (x: number, y: number) => {
      if (!sessionRef.current) return;
      const deltaX = x - sessionRef.current.startX;
      const deltaY = y - sessionRef.current.startY;
      const elapsed = Date.now() - sessionRef.current.startTime;
      sessionRef.current = null;

      if (elapsed > maxDurationMs) return;
      if (Math.abs(deltaY) > thresholdY) return;

      if (deltaX < -thresholdX && onSwipeLeft) {
        onSwipeLeft();
      } else if (deltaX > thresholdX && onSwipeRight) {
        onSwipeRight();
      }
    },
    [thresholdX, thresholdY, maxDurationMs, onSwipeLeft, onSwipeRight]
  );

  const cancel = useCallback(() => {
    sessionRef.current = null;
  }, []);

  return {
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length > 0) {
        start(e.touches[0].clientX, e.touches[0].clientY);
      }
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (e.touches.length > 0) {
        move(e.touches[0].clientX, e.touches[0].clientY);
      }
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (e.changedTouches.length > 0) {
        end(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      }
    },
    onTouchCancel: cancel,
    onPointerDown: (e: React.PointerEvent) => {
      start(e.clientX, e.clientY);
    },
    onPointerMove: (e: React.PointerEvent) => {
      move(e.clientX, e.clientY);
    },
    onPointerUp: (e: React.PointerEvent) => {
      end(e.clientX, e.clientY);
    },
    onPointerCancel: cancel
  };
}

export function useGlobalSwipe(config: SwipeConfig, enabled = true): void {
  const {
    thresholdX = 60,
    thresholdY = 40,
    maxDurationMs = 400,
    onSwipeLeft,
    onSwipeRight
  } = config;

  const sessionRef = useRef<TouchSession | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        sessionRef.current = {
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          startTime: Date.now()
        };
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!sessionRef.current || !e.changedTouches.length) return;
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - sessionRef.current.startX;
      const deltaY = touch.clientY - sessionRef.current.startY;
      const elapsed = Date.now() - sessionRef.current.startTime;
      sessionRef.current = null;

      if (elapsed > maxDurationMs) return;
      if (Math.abs(deltaY) > thresholdY) return;

      if (deltaX < -thresholdX && onSwipeLeft) {
        onSwipeLeft();
      } else if (deltaX > thresholdX && onSwipeRight) {
        onSwipeRight();
      }
    };

    const handleTouchCancel = () => {
      sessionRef.current = null;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [enabled, thresholdX, thresholdY, maxDurationMs, onSwipeLeft, onSwipeRight]);
}
