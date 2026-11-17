// @vitest-environment jsdom
import './setup.js';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSwipe } from '../../pocket-web/src/hooks/useSwipe.js';

const TestSwipeComponent: React.FC<{
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}> = ({ onSwipeLeft, onSwipeRight }) => {
  const handlers = useSwipe({ onSwipeLeft, onSwipeRight, thresholdX: 60, thresholdY: 40 });
  return (
    <div data-testid="swipe-target" {...handlers}>
      Swipe Target
    </div>
  );
};

describe('Tier 3: useSwipe Hook', () => {
  it('TC-SW-01: horizontal left swipe (deltaX < -60px, deltaY < 40px) triggers onSwipeLeft', () => {
    const onSwipeLeft = vi.fn();
    render(<TestSwipeComponent onSwipeLeft={onSwipeLeft} />);

    const target = screen.getByTestId('swipe-target');
    fireEvent.pointerDown(target, { clientX: 200, clientY: 100 });
    fireEvent.pointerUp(target, { clientX: 120, clientY: 110 });

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  it('TC-SW-02: small horizontal swipe (deltaX = -40px) does not trigger onSwipeLeft', () => {
    const onSwipeLeft = vi.fn();
    render(<TestSwipeComponent onSwipeLeft={onSwipeLeft} />);

    const target = screen.getByTestId('swipe-target');
    fireEvent.pointerDown(target, { clientX: 200, clientY: 100 });
    fireEvent.pointerUp(target, { clientX: 160, clientY: 100 });

    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('TC-SW-03: diagonal or vertical swipe (deltaY = 55px > 40px) cancels swipe', () => {
    const onSwipeLeft = vi.fn();
    render(<TestSwipeComponent onSwipeLeft={onSwipeLeft} />);

    const target = screen.getByTestId('swipe-target');
    fireEvent.pointerDown(target, { clientX: 200, clientY: 100 });
    fireEvent.pointerUp(target, { clientX: 120, clientY: 160 });

    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('TC-SW-04: right swipe (deltaX > 60px) triggers onSwipeRight', () => {
    const onSwipeRight = vi.fn();
    render(<TestSwipeComponent onSwipeRight={onSwipeRight} />);

    const target = screen.getByTestId('swipe-target');
    fireEvent.pointerDown(target, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(target, { clientX: 180, clientY: 105 });

    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it('TC-SW-05: pointerCancel cancels swipe gesture tracking', () => {
    const onSwipeLeft = vi.fn();
    render(<TestSwipeComponent onSwipeLeft={onSwipeLeft} />);

    const target = screen.getByTestId('swipe-target');
    fireEvent.pointerDown(target, { clientX: 200, clientY: 100 });
    fireEvent.pointerCancel(target);
    fireEvent.pointerUp(target, { clientX: 120, clientY: 100 });

    expect(onSwipeLeft).not.toHaveBeenCalled();
  });
});
