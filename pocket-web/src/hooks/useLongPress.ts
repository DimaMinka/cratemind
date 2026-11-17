import React, { useRef, useEffect, useCallback } from 'react';

export interface UseLongPressOptions {
  delay?: number;
  threshold?: number;
  vibrateMs?: number;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
}

export interface UseLongPressReturn {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
}

export function useLongPress(
  onLongPress: (e?: React.PointerEvent) => void,
  options: UseLongPressOptions = {}
): UseLongPressReturn {
  const { delay = 450, threshold = 10, vibrateMs = 50, onClick, disabled = false } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressTriggeredRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancelPress = useCallback(() => {
    clearTimer();
    startPosRef.current = null;
  }, [clearTimer]);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleGlobalRelease = () => {
      cancelPress();
    };
    window.addEventListener('pointerup', handleGlobalRelease);
    window.addEventListener('pointercancel', handleGlobalRelease);
    return () => {
      window.removeEventListener('pointerup', handleGlobalRelease);
      window.removeEventListener('pointercancel', handleGlobalRelease);
    };
  }, [cancelPress]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      isLongPressTriggeredRef.current = false;
      startPosRef.current = { x: e.clientX, y: e.clientY };

      clearTimer();
      timerRef.current = setTimeout(() => {
        isLongPressTriggeredRef.current = true;
        onLongPress(e);
        if (
          typeof navigator !== 'undefined' &&
          'vibrate' in navigator &&
          typeof navigator.vibrate === 'function'
        ) {
          navigator.vibrate(vibrateMs);
        }
        timerRef.current = null;
      }, delay);
    },
    [disabled, delay, onLongPress, vibrateMs, clearTimer]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPosRef.current || !timerRef.current) return;
      const distance = Math.hypot(
        e.clientX - startPosRef.current.x,
        e.clientY - startPosRef.current.y
      );
      if (distance > threshold) {
        clearTimer();
      }
    },
    [threshold, clearTimer]
  );

  const onPointerUp = useCallback(() => {
    cancelPress();
  }, [cancelPress]);

  const onPointerLeave = useCallback(() => {
    cancelPress();
  }, [cancelPress]);

  const onPointerCancel = useCallback(() => {
    cancelPress();
  }, [cancelPress]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      if (isLongPressTriggeredRef.current) {
        e.preventDefault();
        e.stopPropagation();
        isLongPressTriggeredRef.current = false;
        return;
      }
      if (onClick) {
        onClick(e);
      }
    },
    [disabled, onClick]
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
    onContextMenu,
    onClick: handleClick
  };
}
