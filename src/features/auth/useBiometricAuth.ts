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
import {
  authenticate as biometricAuthenticate,
  isSensorAvailable,
} from './biometricService';
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
      setBusy(true);
      try {
        const ok = await verifyPin(pin);
        if (!mountedRef.current) {
          return ok;
        }
        if (ok) {
          succeed();
        } else {
          setPinError(true);
        }
        return ok;
      } finally {
        if (mountedRef.current) {
          setBusy(false);
        }
      }
    },
    [succeed],
  );

  return {
    stage,
    busy,
    pinConfigured,
    pinError,
    retryBiometric,
    usePinFallback,
    submitPin,
    clearPinError,
  };
}
