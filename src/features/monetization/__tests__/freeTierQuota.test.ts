/**
 * Unit tests for the pure free-tier quota core (DMY-11).
 *
 * Fully deterministic: every timestamp is supplied explicitly (no real clock),
 * so local-midnight rollover and edge cases are reproducible. Timestamps are
 * built with `new Date(y, m, d, ...)` which constructs LOCAL time, matching the
 * local date-key logic under test regardless of the runner's timezone.
 */
import {
  addUsage,
  EMPTY_QUOTA,
  FREE_TIER_DAILY_LIMIT_MS,
  isExhausted,
  localDateKey,
  QuotaState,
  remainingMs,
  rolloverForToday,
} from '../freeTierQuota';

/** Local-time epoch ms for a given local date/time. */
function at(
  year: number,
  monthIndex: number,
  day: number,
  h = 0,
  min = 0,
  s = 0,
): number {
  return new Date(year, monthIndex, day, h, min, s, 0).getTime();
}

const MINUTE = 60 * 1000;

describe('freeTierQuota — constants', () => {
  it('caps the free tier at exactly one hour', () => {
    expect(FREE_TIER_DAILY_LIMIT_MS).toBe(60 * 60 * 1000);
  });
});

describe('localDateKey', () => {
  it('formats the LOCAL calendar date as YYYY-MM-DD', () => {
    expect(localDateKey(at(2026, 5, 1, 9, 30))).toBe('2026-06-01');
  });

  it('zero-pads month and day', () => {
    expect(localDateKey(at(2026, 0, 3, 0, 5))).toBe('2026-01-03');
  });

  it('returns the same key for two instants on the same local day', () => {
    const a = localDateKey(at(2026, 5, 1, 0, 0, 1));
    const b = localDateKey(at(2026, 5, 1, 23, 59, 59));
    expect(a).toBe(b);
  });

  it('returns a different key just across local midnight', () => {
    const before = localDateKey(at(2026, 5, 1, 23, 59, 59));
    const after = localDateKey(at(2026, 5, 2, 0, 0, 0));
    expect(before).not.toBe(after);
  });
});

describe('addUsage — accumulation', () => {
  it('accumulates time within the same local day', () => {
    const now = at(2026, 5, 1, 10, 0);
    let state = addUsage(EMPTY_QUOTA, 10 * MINUTE, now);
    state = addUsage(state, 5 * MINUTE, now);
    expect(state.usedMs).toBe(15 * MINUTE);
    expect(state.dateKey).toBe('2026-06-01');
  });

  it('reaches the cap and is then exhausted at exactly 1h', () => {
    const now = at(2026, 5, 1, 10, 0);
    const state = addUsage(EMPTY_QUOTA, FREE_TIER_DAILY_LIMIT_MS, now);
    expect(state.usedMs).toBe(FREE_TIER_DAILY_LIMIT_MS);
    expect(isExhausted(state, now)).toBe(true);
    expect(remainingMs(state, now)).toBe(0);
  });

  it('is not exhausted just under the cap', () => {
    const now = at(2026, 5, 1, 10, 0);
    const state = addUsage(EMPTY_QUOTA, FREE_TIER_DAILY_LIMIT_MS - 1, now);
    expect(isExhausted(state, now)).toBe(false);
    expect(remainingMs(state, now)).toBe(1);
  });

  it('clamps the total at the daily limit (cannot overshoot)', () => {
    const now = at(2026, 5, 1, 10, 0);
    const state = addUsage(EMPTY_QUOTA, FREE_TIER_DAILY_LIMIT_MS * 5, now);
    expect(state.usedMs).toBe(FREE_TIER_DAILY_LIMIT_MS);
  });
});

describe('addUsage — bad deltas', () => {
  const now = at(2026, 5, 1, 10, 0);
  const seeded: QuotaState = { usedMs: 7 * MINUTE, dateKey: '2026-06-01' };

  it.each([
    ['negative', -1000],
    ['zero', 0],
    ['NaN', NaN],
    ['+Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('ignores a %s delta (counter unchanged)', (_label, delta) => {
    const state = addUsage(seeded, delta as number, now);
    expect(state.usedMs).toBe(7 * MINUTE);
  });

  it('still rolls over a stale day even when the delta is ignored', () => {
    const stale: QuotaState = { usedMs: 40 * MINUTE, dateKey: '2026-05-31' };
    const state = addUsage(stale, 0, now); // delta ignored, but day changed
    expect(state.usedMs).toBe(0);
    expect(state.dateKey).toBe('2026-06-01');
  });
});

describe('rollover at local midnight', () => {
  it('resets the counter to 0 on a new local day', () => {
    const day1 = at(2026, 5, 1, 23, 50);
    let state = addUsage(EMPTY_QUOTA, 30 * MINUTE, day1);
    expect(state.usedMs).toBe(30 * MINUTE);

    const day2 = at(2026, 5, 2, 0, 1); // just past local midnight
    state = rolloverForToday(state, day2);
    expect(state.usedMs).toBe(0);
    expect(state.dateKey).toBe('2026-06-02');
  });

  it('remainingMs reports the full limit right after midnight even on stale state', () => {
    const stale: QuotaState = { usedMs: FREE_TIER_DAILY_LIMIT_MS, dateKey: '2026-06-01' };
    const nextDay = at(2026, 5, 2, 0, 0, 0);
    expect(remainingMs(stale, nextDay)).toBe(FREE_TIER_DAILY_LIMIT_MS);
    expect(isExhausted(stale, nextDay)).toBe(false);
  });

  it('handles a session that crosses midnight: spends the new day budget', () => {
    // 50 min used late on day 1.
    let state = addUsage(EMPTY_QUOTA, 50 * MINUTE, at(2026, 5, 1, 23, 30));
    expect(state.usedMs).toBe(50 * MINUTE);

    // A tick after midnight rolls over, then accrues the new day's 2 min.
    state = addUsage(state, 2 * MINUTE, at(2026, 5, 2, 0, 5));
    expect(state.dateKey).toBe('2026-06-02');
    expect(state.usedMs).toBe(2 * MINUTE);
    expect(isExhausted(state, at(2026, 5, 2, 0, 5))).toBe(false);
  });

  it('returns the SAME reference when no rollover is needed', () => {
    const state: QuotaState = { usedMs: 5 * MINUTE, dateKey: '2026-06-01' };
    const out = rolloverForToday(state, at(2026, 5, 1, 12, 0));
    expect(out).toBe(state);
  });

  it('first-ever record stamps today even from null dateKey', () => {
    const state = rolloverForToday(EMPTY_QUOTA, at(2026, 5, 1, 8, 0));
    expect(state.dateKey).toBe('2026-06-01');
    expect(state.usedMs).toBe(0);
  });
});

describe('remainingMs / isExhausted basics', () => {
  it('reports remaining within a day', () => {
    const now = at(2026, 5, 1, 10, 0);
    const state = addUsage(EMPTY_QUOTA, 20 * MINUTE, now);
    expect(remainingMs(state, now)).toBe(FREE_TIER_DAILY_LIMIT_MS - 20 * MINUTE);
    expect(isExhausted(state, now)).toBe(false);
  });

  it('never returns a negative remaining', () => {
    const over: QuotaState = {
      usedMs: FREE_TIER_DAILY_LIMIT_MS + 999,
      dateKey: '2026-06-01',
    };
    expect(remainingMs(over, at(2026, 5, 1, 10, 0))).toBe(0);
  });
});
