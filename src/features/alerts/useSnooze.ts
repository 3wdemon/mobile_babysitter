/**
 * useSnooze — React glue for the alert snooze gesture (DMY-28).
 *
 * Owns the snooze interaction on top of an {@link AlertService}: a single
 * `snooze()` action (invoked by the parent's haptic gesture on the alert
 * indicator) tells the service to mute non-safety-critical alerts for
 * {@link SNOOZE_DURATION_MS}, fires the injected {@link HapticFeedback} to
 * confirm the gesture, and exposes reactive `snoozedUntil` so the UI can render
 * a "snoozed until HH:MM" badge that clears itself when the window elapses.
 *
 * The hook NEVER plays sounds or reads detection — that all lives in the
 * service. It only schedules a single timer to flip its own `snoozedUntil`
 * state back to `null` when the snooze ends (the service is already
 * self-expiring via its clock; this timer is purely to re-render the badge).
 * Both the timer and any active snooze are cleaned up on unmount.
 *
 * Clock is injectable (mirrors the service) so tests are deterministic.
 *
 * Privacy: snooze carries only a timestamp; no metric, frame, audio or media.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AlertService, Clock } from './alertService';
import { noopHaptic, type HapticFeedback } from './hapticFeedback';

/** Default snooze interval: 5 minutes. Configurable per call/options. */
export const SNOOZE_DURATION_MS = 5 * 60 * 1000;

/** Options for {@link useSnooze}. */
export interface UseSnoozeOptions {
  /** The service whose alerts are snoozed. Required. */
  readonly service: AlertService;
  /** Haptic used to confirm the gesture. Defaults to a no-op. */
  readonly haptic?: HapticFeedback;
  /** Snooze interval in ms. Defaults to {@link SNOOZE_DURATION_MS}. */
  readonly durationMs?: number;
  /** Time source, epoch ms. Defaults to `Date.now`. Injectable for tests. */
  readonly now?: Clock;
}

/** Value returned by {@link useSnooze}. */
export interface SnoozeState {
  /** Epoch ms the snooze runs until, or `null` when not snoozed. */
  readonly snoozedUntil: number | null;
  /** Convenience flag: `snoozedUntil !== null`. */
  readonly isSnoozed: boolean;
  /** Trigger a snooze (mutes non-cry alerts + fires the haptic). */
  readonly snooze: () => void;
  /** Cancel an active snooze immediately. */
  readonly cancelSnooze: () => void;
}

export function useSnooze(options: UseSnoozeOptions): SnoozeState {
  const {
    service,
    haptic = noopHaptic,
    durationMs = SNOOZE_DURATION_MS,
    now = Date.now,
  } = options;

  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null);

  // Latest values in refs so a re-created callback never tears down the timer
  // logic and changing options does not force a re-subscribe.
  const serviceRef = useRef(service);
  serviceRef.current = service;
  const hapticRef = useRef(haptic);
  hapticRef.current = haptic;
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;
  const nowRef = useRef(now);
  nowRef.current = now;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancelSnooze = useCallback(() => {
    clearTimer();
    serviceRef.current.clearSnooze();
    setSnoozedUntil(null);
  }, [clearTimer]);

  const snooze = useCallback(() => {
    const until = serviceRef.current.snooze(durationRef.current);
    if (until === null) {
      // Ignored (non-positive duration); leave state untouched.
      return;
    }
    // Confirm the gesture haptically. The abstraction guarantees no throw.
    hapticRef.current.trigger();
    setSnoozedUntil(until);

    // Schedule a single re-render to clear the badge when the window elapses.
    clearTimer();
    const remaining = Math.max(0, until - nowRef.current());
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setSnoozedUntil(null);
    }, remaining);
  }, [clearTimer]);

  // Tear down on unmount: cancel the timer and any active snooze so a stale
  // snooze never outlives the screen.
  useEffect(() => {
    return () => {
      clearTimer();
      serviceRef.current.clearSnooze();
    };
  }, [clearTimer]);

  return {
    snoozedUntil,
    isSnoozed: snoozedUntil !== null,
    snooze,
    cancelSnooze,
  };
}
