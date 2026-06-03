/**
 * useFreeTierSession — drives the free-tier daily cap during a live monitoring
 * session (DMY-11).
 *
 * While `active` is true and the user is NOT premium, the hook ticks on an
 * interval, accumulating elapsed wall-clock time into the persisted free-tier
 * counter (`useAppStore.addFreeTierUsage`). The moment the daily cap
 * ({@link FREE_TIER_DAILY_LIMIT_MS}) is reached it:
 *  - marks the session `exhausted`, and
 *  - invokes `onLimitReached` EXACTLY ONCE so the caller can softly end the
 *    session and surface the upgrade CTA.
 *
 * Honest by design: there is no countdown / pressure timer. The session simply
 * runs until the budget is spent, then stops. Premium removes the cap entirely
 * (the interval never even starts). A clock is injected for deterministic tests;
 * production uses `Date.now`.
 *
 * FREE_MODE (DMY-51): for the MVP the cap is disabled app-wide via the
 * {@link FREE_MODE} flag. The cap applies ONLY when `!isPremium && !FREE_MODE`
 * (`capApplies`). With FREE_MODE on, sessions of any length never accrue toward
 * the cap, never exhaust, and never surface an upgrade state — WITHOUT touching
 * `isPremium`, so flipping FREE_MODE=false restores DMY-11 exactly. The flag is
 * injectable here (`freeMode` option) purely so tests can exercise the
 * underlying cap with FREE_MODE conceptually off; production reads the constant.
 *
 * Accuracy across rollover: usage is measured by wall-clock delta between ticks
 * (not tick count), and the pure quota core resets at LOCAL midnight, so a
 * session crossing midnight correctly starts spending the new day's budget.
 */
import { useEffect, useRef } from 'react';

import { useAppStore } from '../../store/useAppStore';
import { FREE_MODE } from './freeMode';
import {
  FREE_TIER_DAILY_LIMIT_MS,
  isExhausted as quotaIsExhausted,
  remainingMs as quotaRemainingMs,
} from './freeTierQuota';

/** How often the session accrues usage, in ms. Default 1s. */
export const DEFAULT_TICK_MS = 1000;

/** A clock returning epoch milliseconds (injectable for determinism). */
export type Clock = () => number;

export interface UseFreeTierSessionOptions {
  /** Whether a monitoring session is currently running. */
  readonly active: boolean;
  /**
   * Called once when the daily free-tier cap is hit during this session, so the
   * caller can softly stop monitoring and show the upgrade CTA.
   */
  readonly onLimitReached?: () => void;
  /** Accrual interval in ms. Defaults to {@link DEFAULT_TICK_MS}. */
  readonly tickMs?: number;
  /** Injectable clock (epoch ms). Defaults to `Date.now`. */
  readonly now?: Clock;
  /**
   * Override for the {@link FREE_MODE} flag (DMY-51). Defaults to the module
   * constant; tests inject `false` to exercise the underlying DMY-11 cap with
   * FREE_MODE conceptually off. Production never passes this.
   */
  readonly freeMode?: boolean;
}

export interface FreeTierSessionState {
  /** Whether the daily cap is reached (session should be soft-stopped). */
  readonly exhausted: boolean;
  /** Whether the user is premium (cap does not apply). */
  readonly isPremium: boolean;
  /** Milliseconds remaining in today's free budget (Infinity for premium). */
  readonly remainingMs: number;
  /** The daily limit in ms (for display). */
  readonly limitMs: number;
}

export function useFreeTierSession(
  options: UseFreeTierSessionOptions,
): FreeTierSessionState {
  const {
    active,
    onLimitReached,
    tickMs = DEFAULT_TICK_MS,
    now,
    freeMode = FREE_MODE,
  } = options;

  const isPremium = useAppStore(s => s.settings.isPremium);
  const usage = useAppStore(s => s.freeTierUsage);
  const addFreeTierUsage = useAppStore(s => s.addFreeTierUsage);

  // The DMY-11 daily cap applies only to non-premium users AND only while
  // FREE_MODE (DMY-51) is off. When FREE_MODE is on every feature is free, so
  // the cap is bypassed entirely — without altering `isPremium` semantics.
  const capApplies = !isPremium && !freeMode;

  const clock = now ?? Date.now;
  // Keep clock + callback in refs so changing them does not restart the timer.
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const onLimitReachedRef = useRef(onLimitReached);
  onLimitReachedRef.current = onLimitReached;

  // Compute exhaustion from the persisted counter (handles local-day rollover).
  // Only when the cap actually applies (non-premium AND FREE_MODE off).
  const exhausted = capApplies && quotaIsExhausted(usage, clock());

  // Guard so onLimitReached fires at most once per exhaustion edge.
  const firedRef = useRef(false);

  // Fire the soft-interruption callback on the rising edge of `exhausted`.
  useEffect(() => {
    if (!capApplies) {
      // Premium OR FREE_MODE: no cap, so re-arm and never fire.
      firedRef.current = false;
      return;
    }
    if (exhausted && !firedRef.current) {
      firedRef.current = true;
      onLimitReachedRef.current?.();
    }
    if (!exhausted) {
      // Budget became available again (e.g. local-day rollover): re-arm.
      firedRef.current = false;
    }
  }, [exhausted, capApplies]);

  // Tick: accrue wall-clock time while active & the cap applies. When the cap
  // does not apply (premium or FREE_MODE) the interval never starts, so a
  // session of any length never accrues toward — or trips — the cap.
  useEffect(() => {
    if (!active || !capApplies) {
      return;
    }

    let last = clockRef.current();
    const id = setInterval(() => {
      const current = clockRef.current();
      const delta = current - last;
      last = current;
      // addFreeTierUsage ignores non-finite / non-positive deltas and clamps to
      // the daily limit; it also rolls over at local midnight internally.
      addFreeTierUsage(delta);
    }, tickMs);

    return () => clearInterval(id);
  }, [active, capApplies, tickMs, addFreeTierUsage]);

  // Remaining is "infinite" whenever the cap does not apply (premium OR
  // FREE_MODE), otherwise it reflects today's leftover budget.
  const remaining = capApplies
    ? quotaRemainingMs(usage, clock())
    : Number.POSITIVE_INFINITY;

  return {
    exhausted,
    isPremium,
    remainingMs: remaining,
    limitMs: FREE_TIER_DAILY_LIMIT_MS,
  };
}
