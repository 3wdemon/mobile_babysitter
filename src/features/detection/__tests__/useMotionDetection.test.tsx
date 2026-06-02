/**
 * Unit tests for useMotionDetection (DMY-25).
 *
 * Uses a controllable stub {@link MotionMetricSource}: the test pushes synthetic
 * motion metrics and asserts the hook updates state, fires `onMotion` /
 * `onNoMotion`, drives the time-based no-motion rule via its internal interval,
 * and unsubscribes on unmount. No real camera/WebRTC is involved — that source
 * (DMY-17/DMY-45) plugs into the same injected contract.
 *
 * Jest fake timers drive both the hook's `setInterval` AND `Date.now()` (the
 * detector's default clock), so the 30s stillness rule is deterministic.
 */
import { act, renderHook } from '@testing-library/react-native';

import { logger } from '../../../services/logger';
import { NO_MOTION_THRESHOLD_MS } from '../motionConfig';
import { useMotionDetection } from '../useMotionDetection';
import type { MotionMetric, MotionMetricSource } from '../motionTypes';

function makeStubSource() {
  let listener: ((metric: MotionMetric) => void) | null = null;
  const unsubscribe = jest.fn(() => {
    listener = null;
  });
  const source: MotionMetricSource = onMetric => {
    listener = onMetric;
    return unsubscribe;
  };
  const emit = (metric: MotionMetric) => {
    listener?.(metric);
  };
  return { source, emit, unsubscribe };
}

const CONFIG = {
  enterThreshold: 0.15,
  exitThreshold: 0.08,
  cooldownMs: 5000,
  noMotionThresholdMs: NO_MOTION_THRESHOLD_MS,
};

describe('useMotionDetection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires onMotion and records lastEvent when the metric crosses the threshold', () => {
    const { source, emit } = makeStubSource();
    const onMotion = jest.fn();

    const { result } = renderHook(() =>
      useMotionDetection({ source, onMotion, config: CONFIG }),
    );

    act(() => emit(0.5));

    expect(onMotion).toHaveBeenCalledTimes(1);
    expect(onMotion.mock.calls[0][0]).toMatchObject({
      type: 'motion',
      metric: 0.5,
      threshold: 0.15,
    });
    expect(result.current.lastEvent?.type).toBe('motion');
    expect(result.current.moving).toBe(true);
    expect(result.current.metric).toBe(0.5);
  });

  it('does not fire below the threshold but still tracks the live metric', () => {
    const { source, emit } = makeStubSource();
    const onMotion = jest.fn();

    const { result } = renderHook(() =>
      useMotionDetection({ source, onMotion, config: CONFIG }),
    );

    act(() => emit(0.05));

    expect(onMotion).not.toHaveBeenCalled();
    expect(result.current.moving).toBe(false);
    expect(result.current.metric).toBe(0.05);
  });

  it('does not spam onMotion while the scene stays moving (hysteresis)', () => {
    const { source, emit } = makeStubSource();
    const onMotion = jest.fn();

    renderHook(() => useMotionDetection({ source, onMotion, config: CONFIG }));

    act(() => {
      emit(0.5);
      emit(0.6);
      emit(0.2);
    });

    expect(onMotion).toHaveBeenCalledTimes(1);
  });

  it('fires onNoMotion after >30s of continuous stillness (via the interval)', () => {
    const { source, emit } = makeStubSource();
    const onNoMotion = jest.fn();

    const { result } = renderHook(() =>
      useMotionDetection({
        source,
        onNoMotion,
        config: CONFIG,
        tickIntervalMs: 1000,
      }),
    );

    act(() => emit(0.01)); // still from t=0

    // Just short of 30s: no event yet.
    act(() => {
      jest.advanceTimersByTime(NO_MOTION_THRESHOLD_MS - 1000);
    });
    expect(onNoMotion).not.toHaveBeenCalled();

    // Cross the 30s boundary on the next tick.
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(onNoMotion).toHaveBeenCalledTimes(1);
    expect(onNoMotion.mock.calls[0][0].type).toBe('no_motion');
    expect(result.current.lastEvent?.type).toBe('no_motion');
  });

  it('resets the stillness timer when motion occurs', () => {
    const { source, emit } = makeStubSource();
    const onNoMotion = jest.fn();

    renderHook(() =>
      useMotionDetection({
        source,
        onNoMotion,
        config: CONFIG,
        tickIntervalMs: 1000,
      }),
    );

    act(() => emit(0.01)); // still
    act(() => {
      jest.advanceTimersByTime(20000); // 20s of stillness
    });
    act(() => emit(0.5)); // motion resets the timer
    act(() => emit(0.01)); // back to still: a NEW stretch begins now
    act(() => {
      jest.advanceTimersByTime(20000); // only 20s since the new stretch began
    });
    expect(onNoMotion).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(NO_MOTION_THRESHOLD_MS); // now well past 30s
    });
    expect(onNoMotion).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe or tick when disabled', () => {
    const { source, emit, unsubscribe } = makeStubSource();
    const onMotion = jest.fn();
    const onNoMotion = jest.fn();

    renderHook(() =>
      useMotionDetection({
        source,
        onMotion,
        onNoMotion,
        enabled: false,
        config: CONFIG,
      }),
    );

    act(() => emit(0.5));
    act(() => {
      jest.advanceTimersByTime(NO_MOTION_THRESHOLD_MS * 2);
    });
    expect(onMotion).not.toHaveBeenCalled();
    expect(onNoMotion).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('unsubscribes and clears the interval on unmount', () => {
    const { source, unsubscribe } = makeStubSource();
    const onNoMotion = jest.fn();

    const { unmount } = renderHook(() =>
      useMotionDetection({ source, onNoMotion, config: CONFIG }),
    );

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    // No no_motion should fire after teardown even past the threshold.
    act(() => {
      jest.advanceTimersByTime(NO_MOTION_THRESHOLD_MS * 2);
    });
    expect(onNoMotion).not.toHaveBeenCalled();
  });

  it('stays idle with no source (real source arrives in DMY-17/DMY-45)', () => {
    const { result } = renderHook(() => useMotionDetection({ config: CONFIG }));
    expect(result.current.metric).toBeNull();
    expect(result.current.moving).toBe(false);
    expect(result.current.lastEvent).toBeNull();
  });

  it('ignores NaN samples (no crash, no false event)', () => {
    const { source, emit } = makeStubSource();
    const onMotion = jest.fn();

    const { result } = renderHook(() =>
      useMotionDetection({ source, onMotion, config: CONFIG }),
    );

    act(() => emit(NaN));
    expect(onMotion).not.toHaveBeenCalled();
    expect(result.current.moving).toBe(false);
  });

  it('logs only the privacy-safe metric, never a frame', () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    try {
      const { source, emit } = makeStubSource();
      renderHook(() => useMotionDetection({ source, config: CONFIG }));

      act(() => emit(0.5));

      expect(infoSpy).toHaveBeenCalled();
      for (const call of infoSpy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toMatch(
          /frame|pixel|image|buffer|jpeg|png|rgb|bitmap|video/i,
        );
      }
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('keeps the same session when only callbacks change (no re-subscribe)', () => {
    const { source, emit, unsubscribe } = makeStubSource();
    const first = jest.fn();
    const second = jest.fn();

    const { rerender } = renderHook(
      ({ cb }: { cb: jest.Mock }) =>
        useMotionDetection({ source, onMotion: cb, config: CONFIG }),
      { initialProps: { cb: first } },
    );

    rerender({ cb: second });
    expect(unsubscribe).not.toHaveBeenCalled();

    act(() => emit(0.5));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
