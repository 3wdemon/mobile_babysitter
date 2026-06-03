/**
 * Unit tests for the reconnect backoff policy + controller (DMY-61).
 *
 * Both layers are pure: `nextDelayMs` is a function and the controller owns no
 * wall-clock and no randomness source of its own — a fake scheduler and a fixed
 * RNG are injected so every delay, jitter value and the attempt cap are asserted
 * deterministically (no real timers, no flake). We cover the AC:
 *   - exponential backoff 1s/2s/4s… capped at the ceiling;
 *   - jitter is deterministic when the RNG is injected;
 *   - success (`connected`) resets the backoff and stops retrying;
 *   - the attempt cap STOPS the loop (no infinite reconnect) and signals failed;
 *   - manual retry() restarts the burst;
 *   - cancel()/reset() disarm.
 */
import {
  nextDelayMs,
  createReconnectController,
  DEFAULT_RECONNECT_POLICY,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
  type ReconnectPolicy,
  type SetTimer,
  type ClearTimer,
} from '../reconnectPolicy';

/** Deterministic scheduler mirroring the iceTimeout test harness. */
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

describe('nextDelayMs (DMY-61 pure backoff)', () => {
  it('exposes the documented named constants', () => {
    expect(RECONNECT_BASE_MS).toBe(1000);
    expect(RECONNECT_MAX_DELAY_MS).toBe(30_000);
    expect(RECONNECT_MAX_ATTEMPTS).toBe(5);
    expect(DEFAULT_RECONNECT_POLICY).toEqual({
      baseMs: 1000,
      maxDelayMs: 30_000,
      maxAttempts: 5,
      jitterRatio: 0,
    });
  });

  it('doubles per attempt: 1s, 2s, 4s, 8s, 16s', () => {
    expect(nextDelayMs(0)).toBe(1000);
    expect(nextDelayMs(1)).toBe(2000);
    expect(nextDelayMs(2)).toBe(4000);
    expect(nextDelayMs(3)).toBe(8000);
    expect(nextDelayMs(4)).toBe(16000);
  });

  it('caps the exponential growth at maxDelayMs', () => {
    // 2^5 * 1000 = 32000 > 30000 → capped.
    expect(nextDelayMs(5)).toBe(30_000);
    expect(nextDelayMs(10)).toBe(30_000);
    expect(nextDelayMs(100)).toBe(30_000);
  });

  it('clamps a negative attempt to 0', () => {
    expect(nextDelayMs(-3)).toBe(1000);
  });

  it('honours a custom policy', () => {
    const policy: ReconnectPolicy = {
      baseMs: 500,
      maxDelayMs: 2000,
      maxAttempts: 3,
      jitterRatio: 0,
    };
    expect(nextDelayMs(0, policy)).toBe(500);
    expect(nextDelayMs(1, policy)).toBe(1000);
    expect(nextDelayMs(2, policy)).toBe(2000);
    expect(nextDelayMs(3, policy)).toBe(2000); // capped
  });

  it('applies jitter deterministically with an injected RNG', () => {
    const policy: ReconnectPolicy = {
      baseMs: 1000,
      maxDelayMs: 30_000,
      maxAttempts: 5,
      jitterRatio: 0.5,
    };
    // rng=0 → no spread (lower bound); rng→1 → full spread.
    expect(nextDelayMs(0, policy, () => 0)).toBe(1000);
    expect(nextDelayMs(0, policy, () => 0.5)).toBe(1000 + 1000 * 0.5 * 0.5); // 1250
    expect(nextDelayMs(1, policy, () => 1)).toBe(2000 + 2000 * 0.5 * 1); // 3000
  });

  it('applies jitter AFTER the cap (bounded worst case)', () => {
    const policy: ReconnectPolicy = {
      baseMs: 1000,
      maxDelayMs: 4000,
      maxAttempts: 5,
      jitterRatio: 0.25,
    };
    // attempt 10 → capped 4000, then jitter on the capped value.
    expect(nextDelayMs(10, policy, () => 1)).toBe(4000 + 4000 * 0.25 * 1);
  });
});

describe('createReconnectController (DMY-61)', () => {
  function setup(policy?: Partial<ReconnectPolicy>) {
    const sched = createFakeScheduler();
    const attemptReconnect = jest.fn();
    const onExhausted = jest.fn();
    const ctrl = createReconnectController({
      attemptReconnect,
      onExhausted,
      setTimer: sched.setTimer,
      clearTimer: sched.clearTimer,
      ...(policy ? { policy: { ...DEFAULT_RECONNECT_POLICY, ...policy } } : {}),
    });
    return { sched, attemptReconnect, onExhausted, ctrl };
  }

  it('does NOT retry on a drop that was never preceded by connected', () => {
    const { ctrl, sched, attemptReconnect } = setup();
    // Never reached connected: an initial handshake failure is not a reconnect.
    ctrl.onState('connecting');
    ctrl.onState('failed');
    expect(ctrl.snapshot().reconnecting).toBe(false);
    expect(sched.pendingCount()).toBe(0);
    expect(attemptReconnect).not.toHaveBeenCalled();
  });

  it('schedules the first attempt with the base delay after an unclean drop', () => {
    const { ctrl, sched } = setup();
    ctrl.onState('connecting');
    ctrl.onState('connected');
    ctrl.onState('disconnected');

    const snap = ctrl.snapshot();
    expect(snap.reconnecting).toBe(true);
    expect(snap.attempt).toBe(1); // 1-based for the UI
    expect(snap.nextRetryInMs).toBe(1000);
    expect(sched.lastDelay()).toBe(1000);
  });

  it('escalates the backoff across successive in-flight failures (1s,2s,4s)', () => {
    const { ctrl, sched, attemptReconnect } = setup();
    ctrl.onState('connected');

    ctrl.onState('disconnected'); // burst starts: schedule attempt 0 @ 1s
    expect(sched.lastDelay()).toBe(1000);

    sched.fireAll(); // attempt 1 fires
    expect(attemptReconnect).toHaveBeenCalledTimes(1);
    expect(ctrl.snapshot().attempt).toBe(2);

    ctrl.onState('connecting'); // in-flight attempt progressing (no-op)
    ctrl.onState('failed'); // in-flight attempt failed → schedule attempt 1 @ 2s
    expect(sched.lastDelay()).toBe(2000);

    sched.fireAll(); // attempt 2 fires
    expect(attemptReconnect).toHaveBeenCalledTimes(2);

    ctrl.onState('failed'); // → schedule attempt 2 @ 4s
    expect(sched.lastDelay()).toBe(4000);
  });

  it('resets the backoff and stops retrying when connected arrives', () => {
    const { ctrl, sched, attemptReconnect } = setup();
    ctrl.onState('connected');
    ctrl.onState('disconnected');
    sched.fireAll(); // attempt fired
    ctrl.onState('failed');
    expect(sched.lastDelay()).toBe(2000); // escalated

    // The next attempt reconnects successfully.
    sched.fireAll();
    ctrl.onState('connected');
    const snap = ctrl.snapshot();
    expect(snap.reconnecting).toBe(false);
    expect(snap.failedPermanently).toBe(false);
    expect(snap.attempt).toBe(0);

    // A LATER drop restarts the backoff from the base delay (1s), not escalated.
    attemptReconnect.mockClear();
    ctrl.onState('disconnected');
    expect(sched.lastDelay()).toBe(1000);
  });

  it('STOPS after max attempts (no infinite loop) and signals exhausted', () => {
    const { ctrl, sched, attemptReconnect, onExhausted } = setup({
      maxAttempts: 3,
    });
    ctrl.onState('connected');
    ctrl.onState('disconnected'); // schedule attempt 0

    // Drive three failing attempts: each fire → attemptReconnect, each failure →
    // schedule the next, until the cap is hit.
    sched.fireAll(); // attempt 1
    ctrl.onState('failed'); // schedule attempt 1
    sched.fireAll(); // attempt 2
    ctrl.onState('failed'); // schedule attempt 2
    sched.fireAll(); // attempt 3
    expect(attemptReconnect).toHaveBeenCalledTimes(3);

    // The 3rd failure is past the cap → exhausted, no further scheduling.
    ctrl.onState('failed');
    const snap = ctrl.snapshot();
    expect(snap.failedPermanently).toBe(true);
    expect(snap.reconnecting).toBe(false);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(sched.pendingCount()).toBe(0);

    // Further drops do NOT resurrect the loop.
    ctrl.onState('failed');
    ctrl.onState('disconnected');
    expect(attemptReconnect).toHaveBeenCalledTimes(3);
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it('manual retry() restarts the burst from the base delay after exhaustion', () => {
    const { ctrl, sched, attemptReconnect, onExhausted } = setup({
      maxAttempts: 1,
    });
    ctrl.onState('connected');
    ctrl.onState('disconnected'); // schedule attempt 0
    sched.fireAll(); // attempt 1 fires
    ctrl.onState('failed'); // past cap (1) → exhausted
    expect(ctrl.snapshot().failedPermanently).toBe(true);
    expect(onExhausted).toHaveBeenCalledTimes(1);

    attemptReconnect.mockClear();
    ctrl.retry();
    const snap = ctrl.snapshot();
    expect(snap.failedPermanently).toBe(false);
    expect(snap.reconnecting).toBe(true);
    expect(snap.attempt).toBe(1);
    expect(sched.lastDelay()).toBe(1000);
    sched.fireAll();
    expect(attemptReconnect).toHaveBeenCalledTimes(1);
  });

  it('does not stack a second timer on redundant drops before the scheduled attempt', () => {
    const { ctrl, sched } = setup();
    ctrl.onState('connected');
    ctrl.onState('disconnected'); // schedule attempt 0
    expect(sched.pendingCount()).toBe(1);
    // A second drop while the timer is still pending must not add another timer.
    ctrl.onState('failed');
    ctrl.onState('disconnected');
    expect(sched.pendingCount()).toBe(1);
  });

  it('cancel() disarms any pending attempt and stops reconnecting', () => {
    const { ctrl, sched, attemptReconnect } = setup();
    ctrl.onState('connected');
    ctrl.onState('disconnected');
    expect(sched.pendingCount()).toBe(1);

    ctrl.cancel();
    expect(ctrl.snapshot().reconnecting).toBe(false);
    sched.fireAll();
    expect(attemptReconnect).not.toHaveBeenCalled();
  });

  it('reset() clears everConnected so a later drop does not retry', () => {
    const { ctrl, sched, attemptReconnect } = setup();
    ctrl.onState('connected');
    ctrl.reset();
    ctrl.onState('disconnected'); // no prior connection in the controller's view
    expect(sched.pendingCount()).toBe(0);
    expect(attemptReconnect).not.toHaveBeenCalled();
  });

  it('uses an injected RNG so the scheduled jitter is deterministic', () => {
    const sched = createFakeScheduler();
    const ctrl = createReconnectController({
      attemptReconnect: jest.fn(),
      onExhausted: jest.fn(),
      setTimer: sched.setTimer,
      clearTimer: sched.clearTimer,
      policy: { ...DEFAULT_RECONNECT_POLICY, jitterRatio: 0.5 },
      rng: () => 1, // upper bound, fully deterministic
    });
    ctrl.onState('connected');
    ctrl.onState('disconnected');
    // base 1000 + 1000 * 0.5 * 1 = 1500
    expect(sched.lastDelay()).toBe(1500);
  });

  it('defaults to host setTimeout/clearTimeout when none injected', () => {
    jest.useFakeTimers();
    try {
      const attemptReconnect = jest.fn();
      const ctrl = createReconnectController({
        attemptReconnect,
        onExhausted: jest.fn(),
        policy: { ...DEFAULT_RECONNECT_POLICY, baseMs: 100 },
      });
      ctrl.onState('connected');
      ctrl.onState('disconnected');
      expect(ctrl.snapshot().reconnecting).toBe(true);
      jest.advanceTimersByTime(100);
      expect(attemptReconnect).toHaveBeenCalledTimes(1);

      // cancel goes through the real clearTimeout.
      ctrl.onState('connected'); // resets
      ctrl.onState('disconnected');
      ctrl.cancel();
      jest.advanceTimersByTime(1000);
      expect(attemptReconnect).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
