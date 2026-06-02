/**
 * Haptic feedback abstraction for the snooze gesture (DMY-28).
 *
 * The alert UI confirms a snooze with a short haptic "tap" so the parent feels
 * the gesture registered without needing to look at a dark night-time screen.
 * Like {@link AlertSoundPlayer}, the orchestration depends ONLY on this thin
 * interface, never on a concrete vibration library — so:
 *
 *  - tests inject a spy and assert `trigger()` was called;
 *  - the shipped default ({@link vibrationHaptic}) uses React Native's built-in
 *    `Vibration` API (no extra native dependency — minimal footprint per the
 *    task brief). It is wrapped so a platform that cannot vibrate degrades to a
 *    no-op instead of throwing;
 *  - {@link noopHaptic} is the safe fallback for environments with no haptics
 *    (e.g. tablets, tests, the web previews) — it never throws and does nothing.
 *
 * Swapping in a richer engine later (e.g. `react-native-haptic-feedback` for
 * iOS impact styles) only means providing another {@link HapticFeedback} at the
 * injection point — no orchestration change.
 *
 * Privacy: a haptic carries no data at all — it is a local, fire-and-forget
 * vibration. Nothing is logged, stored or sent.
 */
import { Vibration } from 'react-native';

import { logger } from '../../services/logger';

/** A source of local haptic feedback. Injectable so tests can spy. */
export interface HapticFeedback {
  /** Fire a short confirmation haptic. Must never throw. */
  trigger(): void;
}

/** Duration (ms) of the snooze-confirmation vibration. Deliberately short. */
export const SNOOZE_HAPTIC_MS = 40;

/**
 * No-op {@link HapticFeedback}: the safe fallback. Does nothing, never throws.
 * Used wherever a device/environment has no usable haptics, and in tests.
 */
export const noopHaptic: HapticFeedback = {
  trigger(): void {
    // Intentionally empty.
  },
};

/**
 * Default {@link HapticFeedback} backed by React Native's built-in `Vibration`.
 * Guards the platform call so a missing/forbidden vibrator degrades gracefully
 * to a no-op rather than crashing the alert UI.
 */
export const vibrationHaptic: HapticFeedback = {
  trigger(): void {
    try {
      Vibration.vibrate(SNOOZE_HAPTIC_MS);
    } catch (error) {
      // Some devices/permissions have no vibrator — never let that break the
      // snooze action. Log only that it failed (no data to leak).
      logger.debug('haptic: vibrate failed, ignoring', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
