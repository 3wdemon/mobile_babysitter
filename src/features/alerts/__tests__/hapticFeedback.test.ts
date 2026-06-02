/**
 * Unit tests for the haptic feedback abstraction (DMY-28).
 *
 * Verifies the no-op fallback is total (never throws, does nothing), and that
 * the default vibration-backed haptic calls the platform `Vibration` API and
 * swallows a failing vibrator instead of crashing the snooze action.
 */
import { Vibration } from 'react-native';

import {
  noopHaptic,
  vibrationHaptic,
  SNOOZE_HAPTIC_MS,
} from '../hapticFeedback';

describe('noopHaptic', () => {
  it('never throws and produces no side effect', () => {
    expect(() => noopHaptic.trigger()).not.toThrow();
  });
});

describe('vibrationHaptic', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('vibrates for the short confirmation duration', () => {
    const spy = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
    vibrationHaptic.trigger();
    expect(spy).toHaveBeenCalledWith(SNOOZE_HAPTIC_MS);
  });

  it('swallows a failing vibrator (degrades to no-op)', () => {
    jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {
      throw new Error('no vibrator');
    });
    expect(() => vibrationHaptic.trigger()).not.toThrow();
  });

  it('swallows a non-Error throw too', () => {
    jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {
      throw 'boom';
    });
    expect(() => vibrationHaptic.trigger()).not.toThrow();
  });
});
