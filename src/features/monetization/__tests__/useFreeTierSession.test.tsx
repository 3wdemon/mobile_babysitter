/**
 * Unit tests for useFreeTierSession (DMY-11).
 *
 * The hook is driven by a controllable clock and Jest fake timers, so usage
 * accrual, cap-hit -> onLimitReached, premium bypass and local-day rollover are
 * all deterministic. It reads/writes the real store (MMKV is mocked in-memory).
 *
 * REVERSIBILITY (DMY-51): the MVP default `FREE_MODE = true` disables the cap.
 * To assert the underlying DMY-11 cap behaviour is preserved EXACTLY, every
 * test here injects `freeMode: false` (FREE_MODE conceptually off, i.e. the
 * DMY-27 cutover). These cases must keep passing byte-for-byte — they prove
 * flipping the flag restores the cap unchanged. FREE_MODE-on behaviour is
 * covered separately in useFreeTierSession.freeMode.test.tsx.
 */
import { act, renderHook } from '@testing-library/react-native';

import { FREE_TIER_DAILY_LIMIT_MS } from '../freeTierQuota';
import { useFreeTierSession } from '../useFreeTierSession';
import { useAppStore } from '../../../store/useAppStore';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

/**
 * A mutable clock the test advances by hand. It drives BOTH the injected hook
 * clock and the store's internal `Date.now()` (the store stamps usage with
 * `Date.now`): `jest.setSystemTime` aligns `Date.now`, and `advance` moves fake
 * timers (which also moves `Date.now`) so the two never drift apart.
 */
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

describe('useFreeTierSession', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('accrues usage while active and reports decreasing remaining time', () => {
    const clock = makeClock(DAY1_10AM);

    const { result } = renderHook(() =>
      useFreeTierSession({
        active: true,
        now: clock.now,
        tickMs: 1000,
        freeMode: false,
      }),
    );

    act(() => clock.advance(10 * MINUTE));

    expect(useAppStore.getState().freeTierUsage.usedMs).toBeGreaterThanOrEqual(
      10 * MINUTE - 1000,
    );
    expect(result.current.remainingMs).toBeLessThanOrEqual(
      FREE_TIER_DAILY_LIMIT_MS - 10 * MINUTE + 1000,
    );
    expect(result.current.exhausted).toBe(false);
  });

  it('hits the 1h cap -> exhausted=true and calls onLimitReached exactly once', () => {
    const clock = makeClock(DAY1_10AM);
    const onLimitReached = jest.fn();

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

    expect(result.current.exhausted).toBe(true);
    expect(result.current.remainingMs).toBe(0);
    expect(onLimitReached).toHaveBeenCalledTimes(1);

    // Keep ticking past the cap: must not fire again (single soft interruption).
    act(() => clock.advance(5 * MINUTE));
    expect(onLimitReached).toHaveBeenCalledTimes(1);
  });

  it('does not tick when the session is inactive', () => {
    const clock = makeClock(DAY1_10AM);

    renderHook(() =>
      useFreeTierSession({
        active: false,
        now: clock.now,
        tickMs: 1000,
        freeMode: false,
      }),
    );

    act(() => clock.advance(20 * MINUTE));
    expect(useAppStore.getState().freeTierUsage.usedMs).toBe(0);
  });

  it('premium removes the cap: no accrual, infinite remaining, no callback', () => {
    const clock = makeClock(DAY1_10AM);
    const onLimitReached = jest.fn();
    act(() => useAppStore.getState().setPremium(true));

    const { result } = renderHook(() =>
      useFreeTierSession({
        active: true,
        now: clock.now,
        tickMs: 1000,
        onLimitReached,
        freeMode: false,
      }),
    );

    act(() => clock.advance(2 * FREE_TIER_DAILY_LIMIT_MS));

    expect(result.current.isPremium).toBe(true);
    expect(result.current.exhausted).toBe(false);
    expect(result.current.remainingMs).toBe(Number.POSITIVE_INFINITY);
    expect(onLimitReached).not.toHaveBeenCalled();
    expect(useAppStore.getState().freeTierUsage.usedMs).toBe(0);
  });

  it('resets and re-arms after local midnight rollover', () => {
    // Start at 22:00 so the full hour is spent BEFORE midnight (on day 1).
    const clock = makeClock(new Date(2026, 5, 1, 22, 0, 0).getTime());
    const onLimitReached = jest.fn();

    // The caller soft-stops the session when the limit is hit (realistic): we
    // mirror that by flipping `active` off, then re-arming on the new day.
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useFreeTierSession({
          active,
          now: clock.now,
          tickMs: 1000,
          onLimitReached,
          freeMode: false,
        }),
      { initialProps: { active: true } },
    );

    // Spend the whole budget on day 1 (ends at 23:00, still day 1).
    act(() => clock.advance(FREE_TIER_DAILY_LIMIT_MS));
    expect(result.current.exhausted).toBe(true);
    expect(onLimitReached).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().freeTierUsage.dateKey).toBe('2026-06-01');

    // Session soft-stops; time passes across local midnight while inactive.
    rerender({ active: false });
    act(() => clock.advance(2 * 60 * MINUTE)); // 23:00 -> 01:00 next day

    // User resumes monitoring on the new day; re-rendering re-evaluates the
    // quota against the new local day, so the budget is full again (rollover).
    rerender({ active: true });
    expect(result.current.exhausted).toBe(false);

    // Spending the cap on the new day fires the soft-interruption once more.
    act(() => clock.advance(FREE_TIER_DAILY_LIMIT_MS));
    expect(result.current.exhausted).toBe(true);
    expect(useAppStore.getState().freeTierUsage.dateKey).toBe('2026-06-02');
    expect(onLimitReached).toHaveBeenCalledTimes(2);
  });

  it('upgrading to premium mid-session lifts an already-exhausted cap', () => {
    const clock = makeClock(DAY1_10AM);
    const onLimitReached = jest.fn();

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
    expect(result.current.exhausted).toBe(true);
    expect(onLimitReached).toHaveBeenCalledTimes(1);

    // User upgrades: the cap no longer applies (placeholder flag, no purchase).
    act(() => useAppStore.getState().setPremium(true));
    expect(result.current.isPremium).toBe(true);
    expect(result.current.exhausted).toBe(false);
    expect(result.current.remainingMs).toBe(Number.POSITIVE_INFINITY);
  });

  it('reflects pre-existing persisted usage from earlier today (app restart)', () => {
    const clock = makeClock(DAY1_10AM);
    // Simulate usage accrued before this hook mounted (e.g. an earlier launch).
    act(() => useAppStore.getState().addFreeTierUsage(55 * MINUTE));

    const { result } = renderHook(() =>
      useFreeTierSession({
        active: true,
        now: clock.now,
        tickMs: 1000,
        freeMode: false,
      }),
    );

    expect(result.current.remainingMs).toBeLessThanOrEqual(5 * MINUTE);
    expect(result.current.exhausted).toBe(false);

    // Five more minutes tips it over the cap.
    act(() => clock.advance(5 * MINUTE));
    expect(result.current.exhausted).toBe(true);
  });
});
