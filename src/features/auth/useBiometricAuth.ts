/**
 * useBiometricAuth — orchestrates the parent-mode unlock flow (DMY-10).
 *
 * Combines the biometric prompt ({@link biometricService}) with the PIN
 * fallback ({@link pinService}) into a small state machine the LockScreen
 * renders against:
 *
 *   checking -> (biometric available) -> biometric prompt
 *                                          | success -> unlocked
 *                                          | declined/error/unavailable -> pin
 *            -> (no biometric)         -> pin
 *
 * On mount it probes the sensor and, when available, immediately fires one
 * biometric prompt. Any non-success outcome (decline, hardware error, no
 * sensor) routes to the PIN stage. The hook never throws — every native call is
 * funnelled through the non-throwing service wrappers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '../../services/logger';
import { useAppStore } from '../../store/useAppStore';
import {
  authenticate as biometricAuthenticate,
  isSensorAvailable,
} from './biometricService';
import {
  DEFAULT_LOCKOUT_POLICY,
  getLockoutStatus,
  type LockoutStatus,
} from './lockoutPolicy';
import { hasPin, verifyPin } from './pinService';

/** Stages of the unlock UI. */
export type AuthStage =
  /** Probing the sensor / deciding the initial path. */
  | 'checking'
  /** A biometric prompt is (or can be) shown. */
  | 'biometric'
  /** Falling back to PIN entry. */
  | 'pin'
  /** Authenticated — the caller should reveal the protected content. */
  | 'unlocked';

/** Message shown in the native biometric sheet. Non-sensitive. */
const PROMPT_MESSAGE = 'Unlock parent mode';

export interface UseBiometricAuthResult {
  /** Current stage of the unlock flow. */
  stage: AuthStage;
  /** True while a biometric probe/prompt is in flight (disable buttons). */
  busy: boolean;
  /** Whether a PIN has been configured (drives PIN-stage copy/affordances). */
  pinConfigured: boolean;
  /** Set after a failed PIN attempt; cleared when the user edits the field. */
  pinError: boolean;
  /**
   * Live lockout status (DMY-44): whether PIN entry is currently rate-limited,
   * when it unlocks, and how many attempts remain. Recomputed each render from
   * the persisted counter and the current clock.
   */
  lockout: LockoutStatus;
  /** (Re)trigger the biometric prompt (e.g. a "Try Face ID again" button). */
  retryBiometric: () => void;
  /** Switch to the PIN stage without waiting for biometrics. */
  usePinFallback: () => void;
  /** Submit a PIN attempt. Resolves to whether it unlocked. */
  submitPin: (pin: string) => Promise<boolean>;
  /** Clear the current PIN error (call on input change). */
  clearPinError: () => void;
}

/**
 * @param onUnlocked Invoked exactly once when authentication succeeds (via
 *   either biometric or PIN). Stable callback recommended.
 */
export function useBiometricAuth(
  onUnlocked: () => void,
): UseBiometricAuthResult {
  const [stage, setStage] = useState<AuthStage>('checking');
  const [busy, setBusy] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [pinError, setPinError] = useState(false);

  // Lockout (DMY-44): the persisted counter lives in the store; the live status
  // is derived from it + the current clock. `nowMs` ticks while locked so the
  // countdown UI updates and the field re-enables exactly when the cooldown
  // elapses.
  const pinLockout = useAppStore(s => s.pinLockout);
  const registerPinFailure = useAppStore(s => s.registerPinFailure);
  const resetPinLockout = useAppStore(s => s.resetPinLockout);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lockout = getLockoutStatus(pinLockout, DEFAULT_LOCKOUT_POLICY, nowMs);

  // While locked, refresh `nowMs` once a second so `remainingMs` counts down and
  // the gate auto-re-enables. No timer runs when unlocked.
  useEffect(() => {
    if (!lockout.locked) {
      return undefined;
    }
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockout.locked]);

  // Guard against firing onUnlocked twice (e.g. biometric resolves right as the
  // user also submits a PIN) and against state updates after unmount.
  const unlockedRef = useRef(false);
  const mountedRef = useRef(true);

  // Keep the latest onUnlocked without re-running effects when it changes.
  const onUnlockedRef = useRef(onUnlocked);
  onUnlockedRef.current = onUnlocked;

  const succeed = useCallback(() => {
    if (unlockedRef.current) {
      return;
    }
    unlockedRef.current = true;
    if (mountedRef.current) {
      setStage('unlocked');
    }
    onUnlockedRef.current();
  }, []);

  const runBiometric = useCallback(async () => {
    if (unlockedRef.current) {
      return;
    }
    setBusy(true);
    try {
      const result = await biometricAuthenticate(PROMPT_MESSAGE);
      if (!mountedRef.current) {
        return;
      }
      if (result.success) {
        succeed();
      } else {
        // Any non-success (declined / unavailable / error) -> PIN fallback.
        setStage('pin');
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }, [succeed]);

  // Initial flow: probe sensor, decide path, optionally prompt once.
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    (async () => {
      const configured = await hasPin();
      if (!cancelled && mountedRef.current) {
        setPinConfigured(configured);
      }

      const sensor = await isSensorAvailable();
      if (cancelled || !mountedRef.current) {
        return;
      }
      if (sensor.available) {
        setStage('biometric');
        await runBiometric();
      } else {
        logger.debug('auth: no biometric sensor, using PIN fallback');
        setStage('pin');
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [runBiometric]);

  const retryBiometric = useCallback(() => {
    setStage('biometric');
    runBiometric().catch(() => {
      // runBiometric is already non-throwing; this is belt-and-braces.
    });
  }, [runBiometric]);

  const usePinFallback = useCallback(() => {
    setStage('pin');
  }, []);

  const clearPinError = useCallback(() => {
    setPinError(false);
  }, []);

  const submitPin = useCallback(
    async (pin: string): Promise<boolean> => {
      // Refuse to even hit the keychain while locked out (rate-limit). Re-derive
      // the status from the freshest clock so a just-elapsed lock is honoured.
      const now = Date.now();
      const status = getLockoutStatus(
        useAppStore.getState().pinLockout,
        DEFAULT_LOCKOUT_POLICY,
        now,
      );
      if (status.locked) {
        logger.info('pin: attempt blocked — locked out');
        if (mountedRef.current) {
          setNowMs(now);
        }
        return false;
      }

      setBusy(true);
      try {
        const ok = await verifyPin(pin);
        if (ok) {
          // Clear the lockout/attempt budget on success.
          resetPinLockout();
        } else {
          // Count the failure; the policy engages a lockout at the threshold.
          registerPinFailure(Date.now());
        }
        if (!mountedRef.current) {
          return ok;
        }
        if (ok) {
          succeed();
        } else {
          setPinError(true);
          setNowMs(Date.now());
        }
        return ok;
      } finally {
        if (mountedRef.current) {
          setBusy(false);
        }
      }
    },
    [registerPinFailure, resetPinLockout, succeed],
  );

  return {
    stage,
    busy,
    pinConfigured,
    pinError,
    lockout,
    retryBiometric,
    usePinFallback,
    submitPin,
    clearPinError,
  };
}
