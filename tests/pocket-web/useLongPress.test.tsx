// @vitest-environment jsdom
import './setup.js';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useLongPress } from '../../pocket-web/src/hooks/useLongPress.js';

const TestLongPressComponent: React.FC<{
  onLongPress: () => void;
  onClick?: () => void;
  delay?: number;
}> = ({ onLongPress, onClick, delay = 450 }) => {
  const handlers = useLongPress(onLongPress, { delay, onClick });
  return (
    <button type="button" {...handlers}>
      Press Me
    </button>
  );
};

describe('Tier 3: useLongPress Hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('TC-LP-01: short click (< 450ms) triggers onClick and does NOT trigger onLongPress', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(<TestLongPressComponent onLongPress={onLongPress} onClick={onClick} />);

    const button = screen.getByText('Press Me');
    act(() => {
      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      vi.advanceTimersByTime(200);
      fireEvent.pointerUp(button);
      fireEvent.click(button);
    });

    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('TC-LP-02: holding for >= 450ms triggers onLongPress and triggers haptics', () => {
    const onLongPress = vi.fn();
    render(<TestLongPressComponent onLongPress={onLongPress} />);

    const button = screen.getByText('Press Me');
    act(() => {
      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      vi.advanceTimersByTime(450);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(navigator.vibrate).toHaveBeenCalledWith(50);
  });

  it('TC-LP-03: moving pointer > 10px cancels the hold timer', () => {
    const onLongPress = vi.fn();
    render(<TestLongPressComponent onLongPress={onLongPress} />);

    const button = screen.getByText('Press Me');
    act(() => {
      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      vi.advanceTimersByTime(200);
      fireEvent.pointerMove(button, { clientX: 125, clientY: 100 });
      vi.advanceTimersByTime(300);
      fireEvent.pointerUp(button);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('TC-LP-04: pointercancel cancels the hold timer', () => {
    const onLongPress = vi.fn();
    render(<TestLongPressComponent onLongPress={onLongPress} />);

    const button = screen.getByText('Press Me');
    act(() => {
      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      vi.advanceTimersByTime(200);
      fireEvent.pointerCancel(button);
      vi.advanceTimersByTime(300);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('TC-LP-05: onContextMenu prevents default context menu', () => {
    const onLongPress = vi.fn();
    render(<TestLongPressComponent onLongPress={onLongPress} />);

    const button = screen.getByText('Press Me');
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(button, event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('TC-LP-06: subsequent click event after long-press is suppressed', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(<TestLongPressComponent onLongPress={onLongPress} onClick={onClick} />);

    const button = screen.getByText('Press Me');
    act(() => {
      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      vi.advanceTimersByTime(450);
      fireEvent.pointerUp(button);
      fireEvent.click(button);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('TC-LP-07: pointerLeave cancels hold timer even after slight move inside threshold', () => {
    const onLongPress = vi.fn();
    render(<TestLongPressComponent onLongPress={onLongPress} />);

    const button = screen.getByText('Press Me');
    act(() => {
      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      vi.advanceTimersByTime(150);
      fireEvent.pointerMove(button, { clientX: 104, clientY: 100 });
      fireEvent.pointerLeave(button);
      vi.advanceTimersByTime(350);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('TC-LP-08: disabled=true suppresses both onLongPress and onClick', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const DisabledComponent: React.FC = () => {
      const handlers = useLongPress(onLongPress, { delay: 450, onClick, disabled: true });
      return (
        <button type="button" {...handlers}>
          Disabled Pad
        </button>
      );
    };
    render(<DisabledComponent />);

    const button = screen.getByText('Disabled Pad');
    act(() => {
      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      vi.advanceTimersByTime(500);
      fireEvent.pointerUp(button);
      fireEvent.click(button);
    });

    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });
});
