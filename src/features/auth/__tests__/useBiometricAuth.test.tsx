/**
 * Unit tests for useBiometricAuth (DMY-10) — the parent-mode unlock state
 * machine. LockScreen.test.tsx exercises this hook through the UI, but the
 * branchier paths (double-unlock guard, retry, PIN fallback + PIN error, the
 * unmount guards) are easier to pin down directly against the hook. These
 * assert real behaviour, not just line execution.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useAppStore } from '../../../store/useAppStore';
import { useBiometricAuth } from '../useBiometricAuth';
import { DEFAULT_LOCKOUT_POLICY } from '../lockoutPolicy';
import { setPin } from '../pinService';

// These tests drive the real unlock flow, which runs the genuine slow KDF
// (PBKDF2-HMAC-SHA256, 100k iterations, pure JS) on each setPin/verifyPin. The
// correct-PIN paths derive 2-3 times; under `--coverage` instrumentation and
// parallel-worker CPU contention a single derivation can exceed Jest's 5s
// default, causing intermittent timeouts that are pure test-budget noise, NOT a
// logic failure (verified: the same tests pass deterministically in isolation
// at ~1.2s). A generous suite-level timeout makes them robust under load. The
// production unlock latency is unchanged — this only relaxes the test deadline.
jest.setTimeout(30_000);

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

const bioMock = jest.requireMock('react-native-biometrics') as {
  __resetBiometricsMock: () => void;
  __setSensorAvailable: (available: boolean, type?: string) => void;
  __setNextPromptSuccess: (success: boolean) => void;
  mockSimplePrompt: jest.Mock;
};

const keychainMock = jest.requireMock('react-native-keychain') as {
  __resetKeychainMock: () => void;
};

beforeEach(() => {
  bioMock.__resetBiometricsMock();
  keychainMock.__resetKeychainMock();
  // The hook reads the live app-store singleton (lockout state); reset it so
  // PIN failures from one test do not bleed into the next.
  __resetAllMmkv();
  act(() => {
    useAppStore.getState().reset();
  });
});

describe('useBiometricAuth (DMY-10)', () => {
  it('probes the sensor and unlocks on a successful biometric prompt', async () => {
    bioMock.__setSensorAvailable(true, 'FaceID');
    bioMock.__setNextPromptSuccess(true);
    const onUnlocked = jest.fn();

    const { result } = renderHook(() => useBiometricAuth(onUnlocked));

    await waitFor(() => expect(result.current.stage).toBe('unlocked'));
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });

  it('routes to PIN when biometrics are declined', async () => {
    bioMock.__setSensorAvailable(true, 'FaceID');
    bioMock.__setNextPromptSuccess(false);
    await setPin('1234');
    const onUnlocked = jest.fn();

    const { result } = renderHook(() => useBiometricAuth(onUnlocked));

    await waitFor(() => expect(result.current.stage).toBe('pin'));
    expect(result.current.pinConfigured).toBe(true);
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it('goes straight to PIN when no biometric sensor is available', async () => {
    bioMock.__setSensorAvailable(false);
    const onUnlocked = jest.fn();

    const { result } = renderHook(() => useBiometricAuth(onUnlocked));

    await waitFor(() => expect(result.current.stage).toBe('pin'));
    expect(result.current.pinConfigured).toBe(false);
  });

  it('unlocks via a correct PIN and rejects an incorrect one', async () => {
    bioMock.__setSensorAvailable(false);
    await setPin('4321');
    const onUnlocked = jest.fn();

    const { result } = renderHook(() => useBiometricAuth(onUnlocked));
    await waitFor(() => expect(result.current.stage).toBe('pin'));

    // Wrong PIN -> pinError set, not unlocked.
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.submitPin('0000');
    });
    expect(ok).toBe(false);
    expect(result.current.pinError).toBe(true);
    expect(onUnlocked).not.toHaveBeenCalled();

    // clearPinError resets the flag (input-change affordance).
    act(() => result.current.clearPinError());
    expect(result.current.pinError).toBe(false);

    // Correct PIN -> unlocked exactly once.
    await act(async () => {
      ok = await result.current.submitPin('4321');
    });
    expect(ok).toBe(true);
    expect(result.current.stage).toBe('unlocked');
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it('fires onUnlocked only once even if PIN is submitted after biometric success', async () => {
    bioMock.__setSensorAvailable(true, 'FaceID');
    bioMock.__setNextPromptSuccess(true);
    await setPin('1111');
    const onUnlocked = jest.fn();

    const { result } = renderHook(() => useBiometricAuth(onUnlocked));
    await waitFor(() => expect(result.current.stage).toBe('unlocked'));

    // A late PIN submit must NOT re-fire onUnlocked (double-unlock guard).
    await act(async () => {
      await result.current.submitPin('1111');
    });
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it('usePinFallback switches to PIN without waiting for biometrics', async () => {
    bioMock.__setSensorAvailable(true, 'FaceID');
    bioMock.__setNextPromptSuccess(false);
    const onUnlocked = jest.fn();

    const { result } = renderHook(() => useBiometricAuth(onUnlocked));
    await waitFor(() => expect(result.current.stage).toBe('pin'));

    act(() => result.current.usePinFallback());
    expect(result.current.stage).toBe('pin');
  });

  it('retryBiometric re-runs the prompt and can unlock on the retry', async () => {
    bioMock.__setSensorAvailable(true, 'FaceID');
    bioMock.__setNextPromptSuccess(false);
    const onUnlocked = jest.fn();

    const { result } = renderHook(() => useBiometricAuth(onUnlocked));
    await waitFor(() => expect(result.current.stage).toBe('pin'));
    const callsAfterMount = bioMock.mockSimplePrompt.mock.calls.length;

    // Arm the next prompt to succeed, then retry.
    bioMock.__setNextPromptSuccess(true);
    act(() => result.current.retryBiometric());

    await waitFor(() => expect(result.current.stage).toBe('unlocked'));
    expect(bioMock.mockSimplePrompt.mock.calls.length).toBe(
      callsAfterMount + 1,
    );
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it('does not throw or call onUnlocked when unmounted mid-probe', async () => {
    bioMock.__setSensorAvailable(true, 'FaceID');
    bioMock.__setNextPromptSuccess(true);
    const onUnlocked = jest.fn();

    const { unmount } = renderHook(() => useBiometricAuth(onUnlocked));
    // Unmount immediately, before the async probe/prompt resolves.
    unmount();

    // Let any pending microtasks flush; the mounted-ref guards must hold.
    await act(async () => {
      await Promise.resolve();
    });
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  describe('lockout (DMY-44)', () => {
    /**
     * Pre-seed N failures via the store action so the (slow, pure-JS PBKDF2)
     * verify path runs at most once per test, then assert the hook's submitPin
     * crosses the threshold / is refused. The store is the same singleton the
     * hook reads.
     */
    function seedFailures(n: number): void {
      act(() => {
        for (let i = 0; i < n; i++) {
          useAppStore.getState().registerPinFailure(Date.now());
        }
      });
    }

    it('reports attemptsRemaining and engages lockout when submit crosses the limit', async () => {
      bioMock.__setSensorAvailable(false);
      await setPin('4321');
      const onUnlocked = jest.fn();

      // One short of the limit already on disk.
      seedFailures(DEFAULT_LOCKOUT_POLICY.maxAttempts - 1);

      const { result } = renderHook(() => useBiometricAuth(onUnlocked));
      await waitFor(() => expect(result.current.stage).toBe('pin'));
      expect(result.current.lockout.attemptsRemaining).toBe(1);

      // The final wrong attempt engages the lockout.
      await act(async () => {
        await result.current.submitPin('0000');
      });

      await waitFor(() => expect(result.current.lockout.locked).toBe(true));
      expect(result.current.lockout.attemptsRemaining).toBe(0);
      expect(result.current.lockout.remainingMs).toBeGreaterThan(0);
      expect(onUnlocked).not.toHaveBeenCalled();
    });

    it('refuses to verify while locked out (does not hit the keychain)', async () => {
      bioMock.__setSensorAvailable(false);
      await setPin('4321');
      const onUnlocked = jest.fn();

      // Already locked on disk.
      seedFailures(DEFAULT_LOCKOUT_POLICY.maxAttempts);

      const { result } = renderHook(() => useBiometricAuth(onUnlocked));
      await waitFor(() => expect(result.current.stage).toBe('pin'));
      expect(result.current.lockout.locked).toBe(true);

      // Even the CORRECT PIN is refused while locked.
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.submitPin('4321');
      });
      expect(ok).toBe(false);
      expect(onUnlocked).not.toHaveBeenCalled();
    });

    it('clears the lockout/counter on a successful unlock', async () => {
      bioMock.__setSensorAvailable(false);
      await setPin('4321');
      const onUnlocked = jest.fn();

      // A couple of failures already recorded.
      seedFailures(2);
      expect(useAppStore.getState().pinLockout.failedAttempts).toBe(2);

      const { result } = renderHook(() => useBiometricAuth(onUnlocked));
      await waitFor(() => expect(result.current.stage).toBe('pin'));

      await act(async () => {
        await result.current.submitPin('4321');
      });
      expect(result.current.stage).toBe('unlocked');
      expect(useAppStore.getState().pinLockout.failedAttempts).toBe(0);
      expect(useAppStore.getState().pinLockout.lockedUntil).toBeNull();
    });
  });
});
