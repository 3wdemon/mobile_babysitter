/**
 * Hook tests for useBatteryStatus (DMY-54).
 *
 * Drive a fake BatterySource and assert: defaults to the neutral UNKNOWN state,
 * re-renders on source emissions, unsubscribes on unmount, and returns a stable
 * snapshot reference across re-renders (no useSyncExternalStore loop).
 */
import { act, renderHook } from '@testing-library/react-native';

import { useBatteryStatus } from '../useBatteryStatus';
import {
  UNKNOWN_BATTERY_STATE,
  makeBatteryState,
  type BatteryListener,
  type BatterySource,
  type BatteryState,
} from '../../features/powersaver/batteryStatus';

/** A controllable fake source: emit() pushes a state to the live listener. */
function createFakeSource(initial: BatteryState = UNKNOWN_BATTERY_STATE) {
  let current = initial;
  let listener: BatteryListener | null = null;
  const calls = { subscribe: 0, unsubscribe: 0 };

  const source: BatterySource = {
    subscribe: l => {
      calls.subscribe += 1;
      listener = l;
      l(current);
      return () => {
        calls.unsubscribe += 1;
        listener = null;
      };
    },
    getCurrent: () => current,
  };

  return {
    source,
    calls,
    emit(state: BatteryState) {
      current = state;
      listener?.(state);
    },
  };
}

describe('useBatteryStatus', () => {
  it('defaults to the neutral UNKNOWN state', () => {
    const fake = createFakeSource();
    const { result } = renderHook(() => useBatteryStatus(fake.source));
    expect(result.current).toEqual<BatteryState>({
      level: null,
      isCharging: null,
      isLow: false,
    });
  });

  it('updates when the source emits a level + charging change', () => {
    const fake = createFakeSource();
    const { result } = renderHook(() => useBatteryStatus(fake.source));

    act(() => fake.emit(makeBatteryState(0.15, false)));
    expect(result.current).toEqual<BatteryState>({
      level: 0.15,
      isCharging: false,
      isLow: true,
    });

    act(() => fake.emit(makeBatteryState(0.15, true)));
    expect(result.current).toEqual<BatteryState>({
      level: 0.15,
      isCharging: true,
      isLow: false,
    });
  });

  it('subscribes once and unsubscribes on unmount', () => {
    const fake = createFakeSource();
    const { unmount } = renderHook(() => useBatteryStatus(fake.source));
    expect(fake.calls.subscribe).toBe(1);
    expect(fake.calls.unsubscribe).toBe(0);
    unmount();
    expect(fake.calls.unsubscribe).toBe(1);
  });

  it('returns a stable snapshot across re-renders with no React warning', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fake = createFakeSource(makeBatteryState(0.5, false));
      const { result, rerender } = renderHook(() =>
        useBatteryStatus(fake.source),
      );

      const first = result.current;
      rerender({});
      rerender({});
      rerender({});

      expect(result.current).toEqual<BatteryState>({
        level: 0.5,
        isCharging: false,
        isLow: false,
      });
      expect(result.current).toBe(first);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not re-subscribe on re-render when the source identity is stable', () => {
    const fake = createFakeSource();
    const { rerender } = renderHook(() => useBatteryStatus(fake.source));
    expect(fake.calls.subscribe).toBe(1);
    rerender({});
    rerender({});
    expect(fake.calls.subscribe).toBe(1);
    expect(fake.calls.unsubscribe).toBe(0);
  });
});
