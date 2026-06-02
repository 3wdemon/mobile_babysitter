/**
 * Hook tests for useNetworkStatus (DMY-60).
 *
 * Drive a fake NetworkSource and assert: defaults to online, re-renders on
 * source emissions, and unsubscribes on unmount.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useNetworkStatus } from '../useNetworkStatus';
import {
  ONLINE_STATE,
  type NetworkListener,
  type NetworkSource,
  type NetworkState,
} from '../../services/network';

/** A controllable fake source: emit() pushes a state to the live listener. */
function createFakeSource(initial: NetworkState = ONLINE_STATE) {
  let current = initial;
  let listener: NetworkListener | null = null;
  const calls = { subscribe: 0, unsubscribe: 0 };

  const source: NetworkSource = {
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
    emit(state: NetworkState) {
      current = state;
      listener?.(state);
    },
  };
}

describe('useNetworkStatus', () => {
  it('defaults to online', () => {
    const fake = createFakeSource();
    const { result } = renderHook(() => useNetworkStatus(fake.source));
    expect(result.current).toEqual<NetworkState>({ isOnline: true, type: null });
  });

  it('updates when the source emits offline then online', () => {
    const fake = createFakeSource();
    const { result } = renderHook(() => useNetworkStatus(fake.source));

    act(() => fake.emit({ isOnline: false, type: 'none' }));
    expect(result.current).toEqual<NetworkState>({ isOnline: false, type: 'none' });

    act(() => fake.emit({ isOnline: true, type: 'wifi' }));
    expect(result.current).toEqual<NetworkState>({ isOnline: true, type: 'wifi' });
  });

  it('subscribes once and unsubscribes on unmount', () => {
    const fake = createFakeSource();
    const { unmount } = renderHook(() => useNetworkStatus(fake.source));
    expect(fake.calls.subscribe).toBe(1);
    expect(fake.calls.unsubscribe).toBe(0);
    unmount();
    expect(fake.calls.unsubscribe).toBe(1);
  });

  it('exposes the network type to consumers', () => {
    const fake = createFakeSource({ isOnline: true, type: 'cellular' });
    const { result } = renderHook(() => useNetworkStatus(fake.source));
    expect(result.current.type).toBe('cellular');
  });

  it('returns a stable snapshot across re-renders with no React warning', () => {
    // useSyncExternalStore logs an error and can wedge into an infinite render
    // loop if getSnapshot returns a fresh value when nothing changed. Force
    // repeated re-renders without emitting and assert: same reference, quiet
    // console.
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fake = createFakeSource({ isOnline: false, type: 'none' });
      const { result, rerender } = renderHook(() => useNetworkStatus(fake.source));

      const first = result.current;
      rerender({});
      rerender({});
      rerender({});

      // Same value, and crucially the SAME reference (cached snapshot).
      expect(result.current).toEqual<NetworkState>({ isOnline: false, type: 'none' });
      expect(result.current).toBe(first);
      // No "getSnapshot should be cached" / update-depth warnings.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not re-subscribe on re-render when the source identity is stable', () => {
    const fake = createFakeSource();
    const { rerender } = renderHook(() => useNetworkStatus(fake.source));
    expect(fake.calls.subscribe).toBe(1);
    rerender({});
    rerender({});
    // Still a single subscription — no churn / leak from render-time work.
    expect(fake.calls.subscribe).toBe(1);
    expect(fake.calls.unsubscribe).toBe(0);
  });
});
