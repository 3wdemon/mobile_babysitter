/**
 * Unit tests for useBiometricAuth (DMY-10) — the parent-mode unlock state
 * machine. LockScreen.test.tsx exercises this hook through the UI, but the
 * branchier paths (double-unlock guard, retry, PIN fallback + PIN error, the
 * unmount guards) are easier to pin down directly against the hook. These
 * assert real behaviour, not just line execution.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useBiometricAuth } from '../useBiometricAuth';
import { setPin } from '../pinService';

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
});
