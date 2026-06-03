/**
 * Lockout / rate-limit policy for parent-mode PIN attempts (DMY-44).
 *
 * Base DMY-10 allowed UNLIMITED PIN guesses, so a low-entropy numeric PIN could
 * be brute-forced at UI speed. This module adds a backoff/lockout: after a
 * threshold of consecutive wrong attempts the gate is locked for a cooldown
 * that grows with the number of overflow attempts, and a clear "locked until"
 * deadline is surfaced to the UI.
 *
 * Everything here is PURE and the clock is INJECTED (`nowMs`), so the timing
 * logic is exhaustively unit-testable without timers or wall-clock flakiness.
 * The persisted shape ({@link LockoutState}) lives in the app store so the
 * counter survives an app restart — a relaunch must NOT reset the attempt
 * budget, otherwise the lockout is trivially bypassed.
 */

/**
 * Persisted lockout state. Tiny and non-sensitive (a counter + two epoch-ms
 * timestamps); contains no PIN material.
 */
export interface LockoutState {
  /** Consecutive failed attempts since the last success/reset. */
  failedAttempts: number;
  /**
   * Epoch-ms until which the gate is locked, or `null` when not locked. A future
   * value means PIN entry is blocked until then.
   */
  lockedUntil: number | null;
  /** Epoch-ms of the most recent failed attempt, or `null`. Diagnostic only. */
  lastFailedAt: number | null;
}

/** The cleared/initial lockout state: no failures, not locked. */
export const EMPTY_LOCKOUT: Readonly<LockoutState> = Object.freeze({
  failedAttempts: 0,
  lockedUntil: null,
  lastFailedAt: null,
});

/**
 * Tunable policy. Defaults: lock after 5 wrong attempts, then an exponential
 * backoff capped at 5 minutes. The first lockout (on the 5th failure) is 30s;
 * each further failure while at/over the threshold doubles it, clamped to the
 * cap. The window is generous enough not to punish a fumbling parent but turns a
 * leaked-blob online guess into days of work.
 */
export interface LockoutPolicy {
  /** Wrong attempts allowed before the FIRST lockout engages. */
  maxAttempts: number;
  /** Cooldown (ms) applied at the threshold; doubled per further failure. */
  baseCooldownMs: number;
  /** Upper bound (ms) on a single cooldown after exponential growth. */
  maxCooldownMs: number;
}

/** Default policy: 5 attempts, 30s base backoff, 5min cap. */
export const DEFAULT_LOCKOUT_POLICY: Readonly<LockoutPolicy> = Object.freeze({
  maxAttempts: 5,
  baseCooldownMs: 30_000,
  maxCooldownMs: 5 * 60_000,
});

/** Live view of the lockout for the UI/caller. */
export interface LockoutStatus {
  /** Whether PIN entry is currently blocked. */
  locked: boolean;
  /** Epoch-ms the lock clears, or `null` when not locked. */
  lockedUntil: number | null;
  /** Milliseconds remaining until unlock (0 when not locked). */
  remainingMs: number;
  /**
   * Attempts left before the next lockout engages. `0` once locked. Clamped to
   * `>= 0` so the UI can render "N tries left".
   */
  attemptsRemaining: number;
}

/** Clamp helper: never report negative remaining time/attempts. */
function clampNonNegative(n: number): number {
  return n > 0 ? n : 0;
}

/**
 * Small safety margin (ms) added to the `maxCooldownMs` ceiling to absorb benign
 * clock skew between the process that WROTE `lockedUntil` and the one reading it.
 */
const LOCKOUT_CLAMP_MARGIN_MS = 1000;

/**
 * ONE-TIME hydration repair for a tampered / bit-rotted `lockedUntil` (DMY-44).
 *
 * The persisted blob is untrusted. A corrupt FINITE far-future deadline (e.g.
 * the max JS date `8.64e15`) passes the pure schema's `finite` check yet would
 * make {@link getLockoutStatus} report `locked:true` for ~275 000 years — an
 * UNRECOVERABLE lockout, because the only thing that clears a lock is a
 * successful PIN verify that {@link canAttempt} refuses to run while locked.
 *
 * By construction every legitimate lock is `writeClock + cooldownFor(...)` and
 * every cooldown is clamped to `policy.maxCooldownMs` (see
 * {@link registerFailure}/{@link cooldownFor}), so no honest lock is ever more
 * than `maxCooldownMs` ahead of the clock that set it. Therefore any
 * `lockedUntil` beyond `nowMs + maxCooldownMs (+ margin)` cannot be legitimate:
 * we cap it to that ceiling.
 *
 * Crucially this is applied ONCE at hydration (the clamped value is then
 * persisted), NOT re-derived on every read — re-anchoring the ceiling to each
 * read's clock would move it forward forever and never self-heal. Applied once,
 * a tampered lock self-heals within one `maxCooldownMs` window. The schema
 * cannot do this (it is intentionally clock-free); the store calls this from its
 * `merge`, where `Date.now()` is legitimately available. A past, in-range, or
 * `null` value is returned unchanged.
 */
export function boundLockoutOnHydration(
  state: LockoutState,
  policy: LockoutPolicy,
  nowMs: number,
): LockoutState {
  if (state.lockedUntil === null) {
    return state;
  }
  const ceiling = nowMs + policy.maxCooldownMs + LOCKOUT_CLAMP_MARGIN_MS;
  if (state.lockedUntil <= ceiling) {
    return state;
  }
  return { ...state, lockedUntil: ceiling };
}

/**
 * Derive the live {@link LockoutStatus} from persisted state at `nowMs`.
 *
 * A `lockedUntil` in the past is treated as expired (not locked), so callers do
 * not need to clear it before reading — the next failed/successful transition
 * will normalise the stored value.
 *
 * Defense-in-depth: even if an out-of-range `lockedUntil` reaches this read path
 * (e.g. it was never run through {@link boundLockoutOnHydration}), the reported
 * `remainingMs`/`lockedUntil` are capped to `nowMs + maxCooldownMs (+ margin)` so
 * the countdown UI can never display an absurd (year-275760) deadline. The
 * durable self-heal is the one-time hydration clamp; this read cap is a display
 * guard.
 */
export function getLockoutStatus(
  state: LockoutState,
  policy: LockoutPolicy,
  nowMs: number,
): LockoutStatus {
  const ceiling = nowMs + policy.maxCooldownMs + LOCKOUT_CLAMP_MARGIN_MS;
  const lockedUntil =
    state.lockedUntil === null
      ? null
      : Math.min(state.lockedUntil, ceiling);
  const locked = lockedUntil !== null && lockedUntil > nowMs;
  const remainingMs = locked ? clampNonNegative(lockedUntil - nowMs) : 0;
  return {
    locked,
    lockedUntil: locked ? lockedUntil : null,
    remainingMs,
    attemptsRemaining: locked
      ? 0
      : clampNonNegative(policy.maxAttempts - state.failedAttempts),
  };
}

/** Whether PIN entry should be ACCEPTED right now (i.e. not locked). */
export function canAttempt(
  state: LockoutState,
  policy: LockoutPolicy,
  nowMs: number,
): boolean {
  return !getLockoutStatus(state, policy, nowMs).locked;
}

/**
 * Compute the cooldown for the `overflow`-th failure at/over the threshold.
 * `overflow = 0` is the failure that first reaches `maxAttempts`. Exponential:
 * `base * 2^overflow`, clamped to `maxCooldownMs`.
 */
function cooldownFor(policy: LockoutPolicy, overflow: number): number {
  const grown = policy.baseCooldownMs * 2 ** clampNonNegative(overflow);
  return Math.min(grown, policy.maxCooldownMs);
}

/**
 * Apply a FAILED attempt at `nowMs`, returning the next persisted state.
 *
 * Increments the failure counter; once it reaches `maxAttempts` a cooldown is
 * set, growing exponentially with each additional failure beyond the threshold.
 * Pure — callers persist the returned value.
 */
export function registerFailure(
  state: LockoutState,
  policy: LockoutPolicy,
  nowMs: number,
): LockoutState {
  const failedAttempts = state.failedAttempts + 1;
  let lockedUntil = state.lockedUntil ?? null;

  if (failedAttempts >= policy.maxAttempts) {
    // overflow 0 on the attempt that first hits the threshold, then 1, 2, ...
    const overflow = failedAttempts - policy.maxAttempts;
    lockedUntil = nowMs + cooldownFor(policy, overflow);
  }

  return {
    failedAttempts,
    lockedUntil,
    lastFailedAt: nowMs,
  };
}

/**
 * Clear the lockout after a SUCCESSFUL unlock. Returns the empty state so the
 * attempt budget is fully restored.
 */
export function registerSuccess(): LockoutState {
  return { ...EMPTY_LOCKOUT };
}
