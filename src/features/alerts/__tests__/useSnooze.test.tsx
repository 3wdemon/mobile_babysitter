/**
 * Unit tests for useSnooze (DMY-28).
 *
 * Drives a real {@link AlertService} (spy player) plus a spy
 * {@link HapticFeedback} and an injected clock, with fake timers for the
 * self-clearing badge. Verifies: the gesture snoozes the service + fires the
 * haptic, non-cry alerts are muted while snoozed and resume after, cry breaks
 * through, and the snooze is torn down on unmount.
 */
import { act, renderHook } from '@testing-library/react-native';

import { createAlertService } from '../alertService';
import { useSnooze, SNOOZE_DURATION_MS } from '../useSnooze';
import type { AlertSoundPlayer } from '../alertTypes';
import type { HapticFeedback } from '../hapticFeedback';

function makeSpyPlayer(): AlertSoundPlayer & {
  playSound: jest.Mock;
  stop: jest.Mock;
} {
  return { playSound: jest.fn(), stop: jest.fn() };
}

function makeSpyHaptic(): HapticFeedback & { trigger: jest.Mock } {
  return { trigger: jest.fn() };
}

function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('useSnooze', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('snooze() snoozes the service and fires the haptic', () => {
    const clock = makeClock(1000);
    const service = createAlertService({
      player: makeSpyPlayer(),
      now: clock.now,
    });
    const haptic = makeSpyHaptic();

    const { result } = renderHook(() =>
      useSnooze({ service, haptic, now: clock.now }),
    );

    expect(result.current.isSnoozed).toBe(false);

    act(() => result.current.snooze());

    expect(haptic.trigger).toHaveBeenCalledTimes(1);
    expect(result.current.isSnoozed).toBe(true);
    expect(result.current.snoozedUntil).toBe(1000 + SNOOZE_DURATION_MS);
    expect(service.isSnoozed()).toBe(true);
  });

  it('mutes a non-cry alert while snoozed, plays it again after the window', () => {
    const clock = makeClock();
    const player = makeSpyPlayer();
    const service = createAlertService({ player, now: clock.now });
    const haptic = makeSpyHaptic();

    const { result } = renderHook(() =>
      useSnooze({ service, haptic, durationMs: 1000, now: clock.now }),
    );

    act(() => result.current.snooze());

    // Muted while snoozed.
    expect(service.handle('noise').droppedReason).toBe('snoozed');
    expect(player.playSound).not.toHaveBeenCalled();

    // Advance past the window: service resumes and the badge clears via timer.
    act(() => {
      clock.advance(1000);
      jest.advanceTimersByTime(1000);
    });

    expect(result.current.isSnoozed).toBe(false);
    expect(service.handle('noise').event).not.toBeNull();
    expect(player.playSound).toHaveBeenCalledTimes(1);
  });

  it('cry still sounds while snoozed (safety break-through)', () => {
    const clock = makeClock();
    const player = makeSpyPlayer();
    const service = createAlertService({ player, now: clock.now });

    const { result } = renderHook(() =>
      useSnooze({ service, durationMs: 1000, now: clock.now }),
    );

    act(() => result.current.snooze());

    expect(service.handle('cry').event?.type).toBe('cry');
    expect(player.playSound).toHaveBeenCalledTimes(1);
  });

  it('cancelSnooze() resumes immediately and clears the badge', () => {
    const clock = makeClock();
    const player = makeSpyPlayer();
    const service = createAlertService({ player, now: clock.now });

    const { result } = renderHook(() =>
      useSnooze({ service, durationMs: 60000, now: clock.now }),
    );

    act(() => result.current.snooze());
    expect(result.current.isSnoozed).toBe(true);

    act(() => result.current.cancelSnooze());

    expect(result.current.isSnoozed).toBe(false);
    expect(service.isSnoozed()).toBe(false);
    expect(service.handle('noise').event).not.toBeNull();
  });

  it('a non-positive duration is ignored (no snooze, no haptic)', () => {
    const service = createAlertService({
      player: makeSpyPlayer(),
      now: () => 0,
    });
    const haptic = makeSpyHaptic();

    const { result } = renderHook(() =>
      useSnooze({ service, haptic, durationMs: 0, now: () => 0 }),
    );

    act(() => result.current.snooze());

    expect(haptic.trigger).not.toHaveBeenCalled();
    expect(result.current.isSnoozed).toBe(false);
  });

  it('defaults to the no-op haptic without throwing', () => {
    const service = createAlertService({
      player: makeSpyPlayer(),
      now: () => 0,
    });

    const { result } = renderHook(() => useSnooze({ service, now: () => 0 }));

    expect(() => act(() => result.current.snooze())).not.toThrow();
    expect(result.current.isSnoozed).toBe(true);
  });

  it('clears the active snooze on unmount (cleanup)', () => {
    const service = createAlertService({
      player: makeSpyPlayer(),
      now: () => 0,
    });

    const { result, unmount } = renderHook(() =>
      useSnooze({ service, durationMs: 60000, now: () => 0 }),
    );

    act(() => result.current.snooze());
    expect(service.isSnoozed()).toBe(true);

    unmount();

    expect(service.isSnoozed()).toBe(false);
  });
});
