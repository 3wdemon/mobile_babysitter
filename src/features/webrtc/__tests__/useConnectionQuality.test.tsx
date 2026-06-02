/**
 * Hook tests for useConnectionQuality (DMY-53).
 *
 * Covers: status-derived level when no provider is given; stats polling on an
 * interval when a provider IS given; reaction to status changes; and timer
 * cleanup on unmount (no leak).
 */
import { act, renderHook } from '@testing-library/react-native';

import {
  DEFAULT_QUALITY_POLL_MS,
  useConnectionQuality,
} from '../useConnectionQuality';
import type { ConnectionStats } from '../connectionQuality';
import { useAppStore } from '../../../store/useAppStore';

describe('useConnectionQuality', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useAppStore.getState().reset();
  });

  afterEach(() => {
    // Drop any scheduled poll WITHOUT firing it (firing outside act() would
    // warn); unmounted hooks have already cleared their own intervals.
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('falls back to the status-derived level when no provider is given', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const { result } = renderHook(() => useConnectionQuality());
    expect(result.current).toBe('good');
  });

  it('reacts to a status change with no provider', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connecting' }));
    const { result } = renderHook(() => useConnectionQuality());
    expect(result.current).toBe('fair');

    act(() => useAppStore.setState({ connectionStatus: 'failed' }));
    expect(result.current).toBe('poor');
  });

  it('uses accurate stats from the provider on first render', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const getStats = (): ConnectionStats => ({ rttMs: 100, packetLossPct: 0 });
    const { result } = renderHook(() => useConnectionQuality(getStats));
    expect(result.current).toBe('excellent');
  });

  it('re-polls the provider on the interval and picks up degradation', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    let sample: ConnectionStats = { rttMs: 100, packetLossPct: 0 };
    const getStats = () => sample;
    const { result } = renderHook(() => useConnectionQuality(getStats));
    expect(result.current).toBe('excellent');

    // Link degrades; next poll should reflect it.
    sample = { rttMs: 700, packetLossPct: 12 };
    act(() => jest.advanceTimersByTime(DEFAULT_QUALITY_POLL_MS));
    expect(result.current).toBe('poor');
  });

  it('honours a custom interval', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    let sample: ConnectionStats = { rttMs: 100, packetLossPct: 0 };
    const getStats = () => sample;
    const { result } = renderHook(() =>
      useConnectionQuality(getStats, { intervalMs: 500 }),
    );
    expect(result.current).toBe('excellent');

    sample = { rttMs: 400, packetLossPct: 0 };
    act(() => jest.advanceTimersByTime(500));
    expect(result.current).toBe('fair');
  });

  it('clears the polling interval on unmount (no leak)', () => {
    const clearSpy = jest.spyOn(globalThis, 'clearInterval');
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const getStats = (): ConnectionStats => ({ rttMs: 100, packetLossPct: 0 });
    const { unmount } = renderHook(() => useConnectionQuality(getStats));

    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('does not poll or setState after unmount (no leak, no state-update warning)', () => {
    // Behavioural guarantee behind the cleanup, not just the clearInterval call:
    // once unmounted, advancing time past several poll cadences must neither
    // re-invoke the provider nor trigger a "state update on an unmounted
    // component" warning (React logs that via console.error).
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const getStats = jest.fn(
      (): ConnectionStats => ({ rttMs: 100, packetLossPct: 0 }),
    );
    const { unmount } = renderHook(() => useConnectionQuality(getStats));

    const callsBeforeUnmount = getStats.mock.calls.length;
    unmount();
    act(() => jest.advanceTimersByTime(DEFAULT_QUALITY_POLL_MS * 3));

    // Provider is not polled again after unmount.
    expect(getStats.mock.calls.length).toBe(callsBeforeUnmount);
    // No React "can't perform a state update on an unmounted component" warning.
    const stateWarnings = errSpy.mock.calls.filter(c =>
      String(c[0]).includes("perform a React state update"),
    );
    expect(stateWarnings).toHaveLength(0);
    errSpy.mockRestore();
  });

  it('falls back to the status level when the provider returns null (no sample)', () => {
    // The pure layer covers this; assert the hook honours it too so a
    // momentarily-empty provider on a live link reads the coarse status floor
    // rather than crashing or reading stale numbers.
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const getStats = (): ConnectionStats | null => null;
    const { result } = renderHook(() => useConnectionQuality(getStats));
    expect(result.current).toBe('good');
  });

  it('does not start a timer when there is no provider', () => {
    const setSpy = jest.spyOn(globalThis, 'setInterval');
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    renderHook(() => useConnectionQuality());
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it('does not crash and falls back when the provider throws', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const throwing = () => {
      throw new Error('boom');
    };
    const { result } = renderHook(() => useConnectionQuality(throwing));
    expect(result.current).toBe('good');
  });
});
