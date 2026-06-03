/**
 * FREE_MODE tests for useFreeTierSession (DMY-51).
 *
 * Asserts the MVP "everything is free" stance: with FREE_MODE on, a non-premium
 * session of ANY length never accrues toward the cap, never exhausts and never
 * fires the upgrade callback — WITHOUT setting `isPremium` (so the underlying
 * DMY-11 semantics are untouched, only gated off).
 *
 * The companion file useFreeTierSession.test.tsx exercises the cap with
 * `freeMode: false` (the DMY-27 cutover), proving the behaviour is reversible.
 */
import { act, renderHook } from '@testing-library/react-native';

import { FREE_TIER_DAILY_LIMIT_MS } from '../freeTierQuota';
import { useFreeTierSession } from '../useFreeTierSession';
import { FREE_MODE } from '../freeMode';
import { useAppStore } from '../../../store/useAppStore';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

function makeClock(startMs: number) {
  let nowMs = startMs;
  jest.setSystemTime(startMs);
  const now = () => nowMs;
  const advance = (deltaMs: number) => {
    nowMs += deltaMs;
    jest.advanceTimersByTime(deltaMs);
  };
  return { now, advance };
}

const MINUTE = 60 * 1000;
const DAY1_10AM = new Date(2026, 5, 1, 10, 0, 0).getTime();

describe('useFreeTierSession under FREE_MODE (DMY-51)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ships with FREE_MODE on as the MVP default', () => {
    expect(FREE_MODE).toBe(true);
  });

  it('a long non-premium session never exhausts and never accrues usage', () => {
    const clock = makeClock(DAY1_10AM);
    const onLimitReached = jest.fn();

    // No freeMode override -> uses the module FREE_MODE (true).
    const { result } = renderHook(() =>
      useFreeTierSession({
        active: true,
        now: clock.now,
        tickMs: 1000,
        onLimitReached,
      }),
    );

    // Drive WELL past the 1h-equivalent budget (3x the daily cap).
    act(() => clock.advance(3 * FREE_TIER_DAILY_LIMIT_MS));

    expect(result.current.exhausted).toBe(false);
    expect(result.current.remainingMs).toBe(Number.POSITIVE_INFINITY);
    expect(onLimitReached).not.toHaveBeenCalled();
    // The interval never started, so the persisted counter stays at zero — and
    // crucially isPremium was never flipped (DMY-11 semantics preserved).
    expect(useAppStore.getState().freeTierUsage.usedMs).toBe(0);
    expect(result.current.isPremium).toBe(false);
    expect(useAppStore.getState().settings.isPremium).toBe(false);
  });

  it('does not surface an upgrade state even with pre-existing exhausting usage', () => {
    const clock = makeClock(DAY1_10AM);
    const onLimitReached = jest.fn();
    // Seed a full day's usage from an earlier (FREE_MODE-off) launch.
    act(() =>
      useAppStore.getState().addFreeTierUsage(FREE_TIER_DAILY_LIMIT_MS),
    );

    const { result } = renderHook(() =>
      useFreeTierSession({
        active: true,
        now: clock.now,
        tickMs: 1000,
        onLimitReached,
      }),
    );

    act(() => clock.advance(5 * MINUTE));

    // Even though the persisted counter is full, FREE_MODE gates the cap off.
    expect(result.current.exhausted).toBe(false);
    expect(result.current.remainingMs).toBe(Number.POSITIVE_INFINITY);
    expect(onLimitReached).not.toHaveBeenCalled();
  });

  it('reversibility: with freeMode injected false, the DMY-11 cap triggers identically', () => {
    const clock = makeClock(DAY1_10AM);
    const onLimitReached = jest.fn();

    // FREE_MODE conceptually off (the DMY-27 cutover) — same call, only the flag
    // differs. A non-premium session must hit the cap exactly as in DMY-11.
    const { result } = renderHook(() =>
      useFreeTierSession({
        active: true,
        now: clock.now,
        tickMs: 1000,
        onLimitReached,
        freeMode: false,
      }),
    );

    act(() => clock.advance(FREE_TIER_DAILY_LIMIT_MS));

    expect(result.current.isPremium).toBe(false);
    expect(result.current.exhausted).toBe(true);
    expect(result.current.remainingMs).toBe(0);
    expect(onLimitReached).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().freeTierUsage.usedMs).toBe(
      FREE_TIER_DAILY_LIMIT_MS,
    );
  });
});
