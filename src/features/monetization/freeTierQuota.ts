/**
 * freeTierQuota — pure free-tier daily-quota core (DMY-11).
 *
 * Framework-free accounting for the honest free tier: up to
 * {@link FREE_TIER_DAILY_LIMIT_MS} (1 hour) of TOTAL monitoring time per LOCAL
 * calendar day. No React, no timers, no I/O. A clock is injected so every
 * decision is deterministic and testable; production passes `Date.now`.
 *
 * Daily rollover is keyed on the device's LOCAL calendar date (a `YYYY-MM-DD`
 * date-key), NOT UTC. Comparing local date-keys means:
 *  - the counter resets at LOCAL midnight (00:00 in the user's timezone), and
 *  - DST transitions / clock changes are handled "for free" — what matters is
 *    only whether the local calendar day label changed, never elapsed UTC.
 *
 * Privacy: the state is a millisecond counter plus an opaque local date-key.
 * Nothing here records audio, video or any personal data.
 */

/** Free-tier cap: total monitoring time allowed per local day, in ms (1 hour). */
export const FREE_TIER_DAILY_LIMIT_MS = 60 * 60 * 1000;

/**
 * Quota state for a single local day. Mirrors `FreeTierUsage` in the store, but
 * declared here so the pure core has no dependency on the store module.
 */
export interface QuotaState {
  /** Milliseconds consumed so far during `dateKey`. */
  readonly usedMs: number;
  /**
   * The local calendar day (`YYYY-MM-DD`, device-local) this counter belongs
   * to, or `null` before any usage has been recorded.
   */
  readonly dateKey: string | null;
}

/** A clock returning epoch milliseconds (injectable for determinism). */
export type Clock = () => number;

/** Initial, empty quota (no usage, no day yet). */
export const EMPTY_QUOTA: QuotaState = { usedMs: 0, dateKey: null };

/**
 * Derive the LOCAL calendar date-key (`YYYY-MM-DD`) for an epoch timestamp.
 *
 * Uses the local getters (`getFullYear`/`getMonth`/`getDate`) so the key
 * reflects the device's timezone. Two instants on the same local day always
 * produce the same key; the first instant past local midnight produces a new
 * key — which is exactly what drives the daily reset.
 */
export function localDateKey(nowMs: number): string {
  const d = new Date(nowMs);
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalise a quota for the current local day: if its `dateKey` does not match
 * today's local date-key (a new local day began), the counter is rolled over to
 * a fresh zero for today. Otherwise it is returned re-stamped with today's key
 * (covers the first-ever record where `dateKey` is `null`).
 *
 * Returns the SAME reference when nothing changes, so callers can cheaply skip
 * a state write.
 */
export function rolloverForToday(state: QuotaState, nowMs: number): QuotaState {
  const today = localDateKey(nowMs);
  if (state.dateKey === today) {
    return state;
  }
  // New local day (or first-ever use): start the day's counter at zero.
  return { usedMs: 0, dateKey: today };
}

/**
 * Add `deltaMs` of consumed time to the quota, after rolling over to today's
 * local day if needed (so usage from a previous day never carries forward).
 *
 * Robustness:
 *  - non-finite (`NaN`/`±Infinity`) or non-positive deltas are ignored (the
 *    rolled-over state is still returned, so a stale day is reset even when the
 *    tick delta is zero),
 *  - the accumulated total is clamped at {@link FREE_TIER_DAILY_LIMIT_MS} so it
 *    cannot grow unbounded once the cap is reached.
 */
export function addUsage(
  state: QuotaState,
  deltaMs: number,
  nowMs: number,
): QuotaState {
  const rolled = rolloverForToday(state, nowMs);

  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return rolled;
  }

  const usedMs = Math.min(
    FREE_TIER_DAILY_LIMIT_MS,
    rolled.usedMs + deltaMs,
  );
  return { usedMs, dateKey: rolled.dateKey };
}

/**
 * Milliseconds remaining for today (never negative). Accounts for a possible
 * rollover at the current instant, so calling this just after local midnight
 * returns the full daily limit even if `state` still holds yesterday's usage.
 */
export function remainingMs(state: QuotaState, nowMs: number): number {
  const rolled = rolloverForToday(state, nowMs);
  return Math.max(0, FREE_TIER_DAILY_LIMIT_MS - rolled.usedMs);
}

/**
 * Whether the daily free-tier quota is exhausted as of `nowMs` (accounting for
 * rollover). `true` only when zero time remains for today.
 */
export function isExhausted(state: QuotaState, nowMs: number): boolean {
  return remainingMs(state, nowMs) <= 0;
}
