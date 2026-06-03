/**
 * Unit tests for the ICE connect-timeout controller (DMY-47).
 *
 * The controller owns no wall-clock: a fake scheduler is injected so every test
 * deterministically controls if/when the timeout fires. We assert the AC:
 *   - fires guidance after the window of `connecting` with no `connected`;
 *   - cancels (no false guidance) when `connected` arrives before the deadline;
 *   - cancels on `disconnected` / `failed` / `closed`;
 *   - re-arms a fresh window on a reconnect (`connecting` again after a cancel).
 */
import {
  createIceTimeout,
  ICE_CONNECT_TIMEOUT_MS,
  type SetTimer,
  type ClearTimer,
} from '../iceTimeout';

/**
 * A minimal deterministic scheduler. Stores at most the pending callbacks keyed
 * by an incrementing handle; `fireAll` invokes the still-pending ones.
 */
function createFakeScheduler(): {
  setTimer: SetTimer;
  clearTimer: ClearTimer;
  fireAll: () => void;
  pendingCount: () => number;
  lastDelay: () => number | null;
} {
  const pending = new Map<number, () => void>();
  let nextHandle = 1;
  let lastDelay: number | null = null;
  return {
    setTimer: (cb, ms) => {
      const handle = nextHandle++;
      lastDelay = ms;
      pending.set(handle, cb);
      return handle;
    },
    clearTimer: handle => {
      pending.delete(handle as number);
    },
    fireAll: () => {
      // Snapshot so a re-arm inside a callback does not loop forever.
      const snapshot = [...pending.entries()];
      pending.clear();
      for (const [, cb] of snapshot) {
        cb();
      }
    },
    pendingCount: () => pending.size,
    lastDelay: () => lastDelay,
  };
}

describe('createIceTimeout (DMY-47)', () => {
  it('exposes a 10s default window', () => {
    expect(ICE_CONNECT_TIMEOUT_MS).toBe(10_000);
  });

  it('fires guidance after the window when connecting never reaches connected', () => {
    const sched = createFakeScheduler();
    const onTimeout = jest.fn();
    const ice = createIceTimeout({
      onTimeout,
      setTimer: sched.setTimer,
      clearTimer: sched.clearTimer,
    });

    ice.onState('connecting');
    expect(ice.isArmed()).toBe(true);
    expect(sched.lastDelay()).toBe(ICE_CONNECT_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();

    sched.fireAll();
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(ice.isArmed()).toBe(false);
  });

  it('cancels on connected before the deadline — no false guidance', () => {
    const sched = createFakeScheduler();
    const onTimeout = jest.fn();
    const ice = createIceTimeout({
      onTimeout,
      setTimer: sched.setTimer,
      clearTimer: sched.clearTimer,
    });

    ice.onState('connecting');
    ice.onState('connected');
    expect(ice.isArmed()).toBe(false);

    // Even if the (now-cleared) timer somehow fired, nothing is pending.
    sched.fireAll();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it.each(['disconnected', 'failed', 'closed'] as const)(
    'cancels the pending timer on %s',
    state => {
      const sched = createFakeScheduler();
      const onTimeout = jest.fn();
      const ice = createIceTimeout({
        onTimeout,
        setTimer: sched.setTimer,
        clearTimer: sched.clearTimer,
      });

      ice.onState('connecting');
      ice.onState(state);
      expect(ice.isArmed()).toBe(false);
      sched.fireAll();
      expect(onTimeout).not.toHaveBeenCalled();
    },
  );

  it('re-arms a fresh window on reconnect (connecting after a cancel)', () => {
    const sched = createFakeScheduler();
    const onTimeout = jest.fn();
    const ice = createIceTimeout({
      onTimeout,
      setTimer: sched.setTimer,
      clearTimer: sched.clearTimer,
    });

    ice.onState('connecting');
    ice.onState('disconnected'); // cancel
    expect(ice.isArmed()).toBe(false);

    ice.onState('connecting'); // reconnect → new window
    expect(ice.isArmed()).toBe(true);
    sched.fireAll();
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('ignores repeated connecting events (does not reset/hide a real hang)', () => {
    const sched = createFakeScheduler();
    const onTimeout = jest.fn();
    const ice = createIceTimeout({
      onTimeout,
      setTimer: sched.setTimer,
      clearTimer: sched.clearTimer,
    });

    ice.onState('connecting');
    ice.onState('connecting'); // duplicate — must NOT re-arm
    ice.onState('connecting');
    expect(sched.pendingCount()).toBe(1);
    sched.fireAll();
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('connected after a fired timeout does not crash and stays disarmed', () => {
    const sched = createFakeScheduler();
    const onTimeout = jest.fn();
    const ice = createIceTimeout({
      onTimeout,
      setTimer: sched.setTimer,
      clearTimer: sched.clearTimer,
    });

    ice.onState('connecting');
    sched.fireAll(); // guidance shown
    expect(onTimeout).toHaveBeenCalledTimes(1);

    ice.onState('connected'); // late recovery
    expect(ice.isArmed()).toBe(false);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('cancel() disarms and allows a later connecting to re-arm', () => {
    const sched = createFakeScheduler();
    const onTimeout = jest.fn();
    const ice = createIceTimeout({
      onTimeout,
      setTimer: sched.setTimer,
      clearTimer: sched.clearTimer,
    });

    ice.onState('connecting');
    ice.cancel();
    expect(ice.isArmed()).toBe(false);
    sched.fireAll();
    expect(onTimeout).not.toHaveBeenCalled();

    ice.onState('connecting');
    expect(ice.isArmed()).toBe(true);
  });

  it('honours a custom timeoutMs', () => {
    const sched = createFakeScheduler();
    const ice = createIceTimeout({
      onTimeout: jest.fn(),
      timeoutMs: 250,
      setTimer: sched.setTimer,
      clearTimer: sched.clearTimer,
    });
    ice.onState('connecting');
    expect(sched.lastDelay()).toBe(250);
  });

  it('defaults to host setTimeout/clearTimeout when none injected', () => {
    jest.useFakeTimers();
    try {
      const onTimeout = jest.fn();
      const ice = createIceTimeout({ onTimeout, timeoutMs: 100 });
      ice.onState('connecting');
      expect(ice.isArmed()).toBe(true);
      jest.advanceTimersByTime(100);
      expect(onTimeout).toHaveBeenCalledTimes(1);

      // And a cancel path through the real clearTimeout.
      const onTimeout2 = jest.fn();
      const ice2 = createIceTimeout({ onTimeout: onTimeout2, timeoutMs: 100 });
      ice2.onState('connecting');
      ice2.onState('connected');
      jest.advanceTimersByTime(200);
      expect(onTimeout2).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
