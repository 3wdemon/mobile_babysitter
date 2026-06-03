import {
  DEFAULT_LOCKOUT_POLICY,
  EMPTY_LOCKOUT,
  boundLockoutOnHydration,
  canAttempt,
  getLockoutStatus,
  registerFailure,
  registerSuccess,
  type LockoutPolicy,
  type LockoutState,
} from '../lockoutPolicy';

/** A small, easy-to-reason-about policy for the timing tests. */
const POLICY: LockoutPolicy = {
  maxAttempts: 3,
  baseCooldownMs: 1000,
  maxCooldownMs: 8000,
};

const T0 = 1_000_000;

function fresh(): LockoutState {
  return { ...EMPTY_LOCKOUT };
}

describe('lockoutPolicy (DMY-44)', () => {
  describe('registerFailure — counting + lockout engagement', () => {
    it('counts failures below the threshold without locking', () => {
      let state = fresh();
      state = registerFailure(state, POLICY, T0);
      expect(state.failedAttempts).toBe(1);
      expect(state.lockedUntil).toBeNull();
      state = registerFailure(state, POLICY, T0 + 1);
      expect(state.failedAttempts).toBe(2);
      expect(state.lockedUntil).toBeNull();
      expect(getLockoutStatus(state, POLICY, T0 + 2).locked).toBe(false);
    });

    it('locks once failures reach maxAttempts (with the base cooldown)', () => {
      let state = fresh();
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0); // 3rd -> threshold
      expect(state.failedAttempts).toBe(3);
      expect(state.lockedUntil).toBe(T0 + POLICY.baseCooldownMs);
      expect(getLockoutStatus(state, POLICY, T0).locked).toBe(true);
    });

    it('records lastFailedAt on each failure', () => {
      let state = fresh();
      state = registerFailure(state, POLICY, T0);
      expect(state.lastFailedAt).toBe(T0);
      state = registerFailure(state, POLICY, T0 + 500);
      expect(state.lastFailedAt).toBe(T0 + 500);
    });
  });

  describe('exponential backoff with an injected clock', () => {
    it('doubles the cooldown for each failure beyond the threshold', () => {
      let state = fresh();
      // Reach the threshold (3rd failure) -> base 1000ms.
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0);
      expect(state.lockedUntil).toBe(T0 + 1000);

      // 4th failure -> base * 2 = 2000ms from the 4th failure's clock.
      state = registerFailure(state, POLICY, T0 + 5000);
      expect(state.lockedUntil).toBe(T0 + 5000 + 2000);

      // 5th failure -> base * 4 = 4000ms.
      state = registerFailure(state, POLICY, T0 + 20000);
      expect(state.lockedUntil).toBe(T0 + 20000 + 4000);
    });

    it('clamps the cooldown to maxCooldownMs', () => {
      let state: LockoutState = {
        failedAttempts: 10, // well beyond the threshold
        lockedUntil: null,
        lastFailedAt: null,
      };
      state = registerFailure(state, POLICY, T0);
      // overflow = 11 - 3 = 8 -> 1000 * 2^8 = 256000, clamped to 8000.
      expect(state.lockedUntil).toBe(T0 + POLICY.maxCooldownMs);
    });
  });

  describe('getLockoutStatus', () => {
    it('reports remaining time and attemptsRemaining while locked', () => {
      let state = fresh();
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0); // locked until T0+1000
      const status = getLockoutStatus(state, POLICY, T0 + 250);
      expect(status.locked).toBe(true);
      expect(status.remainingMs).toBe(750);
      expect(status.attemptsRemaining).toBe(0);
      expect(status.lockedUntil).toBe(T0 + 1000);
    });

    it('treats an elapsed lockedUntil as not locked', () => {
      let state = fresh();
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0);
      const status = getLockoutStatus(state, POLICY, T0 + 5000);
      expect(status.locked).toBe(false);
      expect(status.remainingMs).toBe(0);
    });

    it('is locked just BEFORE lockedUntil and unlocked AT/after it (boundary)', () => {
      let state = fresh();
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0); // locked until T0 + 1000
      const until = T0 + POLICY.baseCooldownMs;
      // t < until -> locked
      expect(getLockoutStatus(state, POLICY, until - 1).locked).toBe(true);
      // t === until -> NOT locked (strictly-greater comparison)
      expect(getLockoutStatus(state, POLICY, until).locked).toBe(false);
      // t > until -> not locked
      expect(getLockoutStatus(state, POLICY, until + 1).locked).toBe(false);
    });

    it('caps the DISPLAYED deadline of a tampered far-future lockedUntil (defense-in-depth)', () => {
      // A corrupt finite far-future deadline (max JS date) survives the pure
      // schema's `finite` check. Even if it reaches the read path unbounded, the
      // status must never SURFACE a ~year-275760 deadline/countdown.
      const poisoned: LockoutState = {
        failedAttempts: 99,
        lockedUntil: 8.64e15, // ~year 275760
        lastFailedAt: null,
      };
      const now = T0;
      const status = getLockoutStatus(poisoned, POLICY, now);
      expect(status.locked).toBe(true);
      expect(status.lockedUntil).not.toBeNull();
      // Displayed deadline / remaining time capped to now + maxCooldownMs (+skew).
      expect(status.lockedUntil! - now).toBeLessThanOrEqual(
        POLICY.maxCooldownMs + 1000,
      );
      expect(status.remainingMs).toBeLessThanOrEqual(POLICY.maxCooldownMs + 1000);
    });

    it('reports attemptsRemaining counting down below the threshold', () => {
      let state = fresh();
      expect(getLockoutStatus(state, POLICY, T0).attemptsRemaining).toBe(3);
      state = registerFailure(state, POLICY, T0);
      expect(getLockoutStatus(state, POLICY, T0).attemptsRemaining).toBe(2);
      state = registerFailure(state, POLICY, T0);
      expect(getLockoutStatus(state, POLICY, T0).attemptsRemaining).toBe(1);
    });

    it('canAttempt mirrors the locked flag', () => {
      let state = fresh();
      expect(canAttempt(state, POLICY, T0)).toBe(true);
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0);
      expect(canAttempt(state, POLICY, T0)).toBe(false);
      // ...and true again once the cooldown elapses.
      expect(canAttempt(state, POLICY, T0 + 2000)).toBe(true);
    });
  });

  describe('boundLockoutOnHydration — anti-permanent-lockout (DMY-44)', () => {
    it('caps a tampered finite far-future lockedUntil to now + maxCooldownMs (+margin)', () => {
      const now = T0;
      const bounded = boundLockoutOnHydration(
        { failedAttempts: 99, lockedUntil: 8.64e15, lastFailedAt: null },
        POLICY,
        now,
      );
      expect(bounded.lockedUntil).toBe(now + POLICY.maxCooldownMs + 1000);
    });

    it('self-heals: the bounded lock clears on its own (no successful verify needed)', () => {
      const now = T0;
      const bounded = boundLockoutOnHydration(
        { failedAttempts: 99, lockedUntil: 8.64e15, lastFailedAt: null },
        POLICY,
        now,
      );
      // Locked right after hydration...
      expect(getLockoutStatus(bounded, POLICY, now).locked).toBe(true);
      // ...but unlocked once the bounded deadline elapses — the crux of the AC.
      const deadline = bounded.lockedUntil as number;
      expect(getLockoutStatus(bounded, POLICY, deadline + 1).locked).toBe(false);
    });

    it('leaves a legitimate in-range lockedUntil untouched (no false repair)', () => {
      const now = T0;
      const legit: LockoutState = {
        failedAttempts: 5,
        lockedUntil: now + POLICY.baseCooldownMs,
        lastFailedAt: now,
      };
      expect(boundLockoutOnHydration(legit, POLICY, now)).toBe(legit);
    });

    it('preserves a null (not-locked) lockedUntil', () => {
      const cleared = { ...EMPTY_LOCKOUT };
      expect(boundLockoutOnHydration(cleared, POLICY, T0)).toBe(cleared);
    });
  });

  describe('registerSuccess', () => {
    it('clears the lockout and attempt budget', () => {
      let state = fresh();
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0);
      state = registerFailure(state, POLICY, T0);
      expect(getLockoutStatus(state, POLICY, T0).locked).toBe(true);

      const cleared = registerSuccess();
      expect(cleared).toEqual(EMPTY_LOCKOUT);
      expect(getLockoutStatus(cleared, POLICY, T0).locked).toBe(false);
      expect(getLockoutStatus(cleared, POLICY, T0).attemptsRemaining).toBe(
        POLICY.maxAttempts,
      );
    });
  });

  describe('default policy', () => {
    it('locks after 5 attempts with a 30s base cooldown capped at 5min', () => {
      expect(DEFAULT_LOCKOUT_POLICY.maxAttempts).toBe(5);
      expect(DEFAULT_LOCKOUT_POLICY.baseCooldownMs).toBe(30_000);
      expect(DEFAULT_LOCKOUT_POLICY.maxCooldownMs).toBe(5 * 60_000);

      let state = fresh();
      for (let i = 0; i < 4; i++) {
        state = registerFailure(state, DEFAULT_LOCKOUT_POLICY, T0);
        expect(getLockoutStatus(state, DEFAULT_LOCKOUT_POLICY, T0).locked).toBe(
          false,
        );
      }
      state = registerFailure(state, DEFAULT_LOCKOUT_POLICY, T0); // 5th
      const status = getLockoutStatus(state, DEFAULT_LOCKOUT_POLICY, T0);
      expect(status.locked).toBe(true);
      expect(status.remainingMs).toBe(30_000);
    });
  });
});
