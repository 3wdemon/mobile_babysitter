import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import LockScreen from '../screens/LockScreen';
import { setPin } from '../pinService';
import { useAppStore } from '../../../store/useAppStore';

const bioMock = jest.requireMock('react-native-biometrics') as {
  __resetBiometricsMock: () => void;
  __setSensorAvailable: (available: boolean, type?: string) => void;
  __setNextPromptSuccess: (success: boolean) => void;
  mockSimplePrompt: jest.Mock;
};

const keychainMock = jest.requireMock('react-native-keychain') as {
  __resetKeychainMock: () => void;
};
const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

describe('LockScreen (DMY-10)', () => {
  beforeEach(() => {
    bioMock.__resetBiometricsMock();
    keychainMock.__resetKeychainMock();
    __resetAllMmkv();
    act(() => {
      useAppStore.getState().reset();
    });
  });

  it('prompts for biometrics on mount and unlocks on success', async () => {
    bioMock.__setSensorAvailable(true, 'FaceID');
    bioMock.__setNextPromptSuccess(true);
    const onUnlock = jest.fn();

    render(<LockScreen onUnlock={onUnlock} />);

    await waitFor(() => expect(bioMock.mockSimplePrompt).toHaveBeenCalled());
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));

    // Prompt message is non-sensitive.
    expect(bioMock.mockSimplePrompt).toHaveBeenCalledWith({
      promptMessage: 'Unlock parent mode',
    });
  });

  it('falls back to PIN entry when biometrics are declined', async () => {
    bioMock.__setSensorAvailable(true, 'FaceID');
    bioMock.__setNextPromptSuccess(false);
    await setPin('1234');
    const onUnlock = jest.fn();

    render(<LockScreen onUnlock={onUnlock} />);

    await waitFor(() =>
      expect(screen.getByTestId('lock-pin-stage')).toBeTruthy(),
    );
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('falls back to PIN entry when no biometric sensor is available', async () => {
    bioMock.__setSensorAvailable(false);
    await setPin('1234');
    const onUnlock = jest.fn();

    render(<LockScreen onUnlock={onUnlock} />);

    await waitFor(() =>
      expect(screen.getByTestId('lock-pin-stage')).toBeTruthy(),
    );
    // No prompt was ever shown.
    expect(bioMock.mockSimplePrompt).not.toHaveBeenCalled();
  });

  it('unlocks with the correct PIN after biometric fallback', async () => {
    bioMock.__setSensorAvailable(false);
    await setPin('4242');
    const onUnlock = jest.fn();

    render(<LockScreen onUnlock={onUnlock} />);
    await waitFor(() =>
      expect(screen.getByTestId('lock-pin-stage')).toBeTruthy(),
    );

    fireEvent.changeText(screen.getByTestId('lock-pin-input'), '4242');
    await act(async () => {
      fireEvent.press(screen.getByTestId('lock-submit-pin'));
    });

    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  });

  it('shows an error and does not unlock on a wrong PIN (no crash)', async () => {
    bioMock.__setSensorAvailable(false);
    await setPin('4242');
    const onUnlock = jest.fn();

    render(<LockScreen onUnlock={onUnlock} />);
    await waitFor(() =>
      expect(screen.getByTestId('lock-pin-stage')).toBeTruthy(),
    );

    fireEvent.changeText(screen.getByTestId('lock-pin-input'), '0000');
    await act(async () => {
      fireEvent.press(screen.getByTestId('lock-submit-pin'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('lock-pin-error')).toBeTruthy(),
    );
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('manual "Use PIN instead" switches to the PIN stage', async () => {
    bioMock.__setSensorAvailable(true, 'FaceID');
    bioMock.__setNextPromptSuccess(false);
    await setPin('1234');

    render(<LockScreen onUnlock={jest.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId('lock-pin-stage')).toBeTruthy(),
    );
    // From the PIN stage we can ask to retry biometrics again.
    fireEvent.press(screen.getByTestId('lock-back-to-biometric'));
    await waitFor(() =>
      expect(screen.getByTestId('lock-biometric-stage')).toBeTruthy(),
    );
  });

  it('disables PIN submission when no PIN is configured', async () => {
    bioMock.__setSensorAvailable(false);
    // No setPin() call -> no PIN configured.

    render(<LockScreen onUnlock={jest.fn()} />);
    await waitFor(() =>
      expect(screen.getByTestId('lock-pin-stage')).toBeTruthy(),
    );

    // Input is not editable, so changeText is a no-op and submit stays disabled.
    expect(screen.getByTestId('lock-pin-input').props.editable).toBe(false);
  });

  it('shows the lockout banner and disables input after repeated wrong PINs (DMY-44)', async () => {
    bioMock.__setSensorAvailable(false);
    await setPin('4242');
    const onUnlock = jest.fn();

    // Pre-seed four failures via the store so only one real (slow, pure-JS
    // PBKDF2) verify runs here; the fifth wrong submit crosses the threshold.
    act(() => {
      for (let i = 0; i < 4; i++) {
        useAppStore.getState().registerPinFailure(Date.now());
      }
    });

    render(<LockScreen onUnlock={onUnlock} />);
    await waitFor(() =>
      expect(screen.getByTestId('lock-pin-stage')).toBeTruthy(),
    );

    fireEvent.changeText(screen.getByTestId('lock-pin-input'), '0000');
    await act(async () => {
      fireEvent.press(screen.getByTestId('lock-submit-pin'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('lock-pin-lockout')).toBeTruthy(),
    );
    // The field is disabled while locked, so the correct PIN cannot be entered.
    expect(screen.getByTestId('lock-pin-input').props.editable).toBe(false);
    expect(onUnlock).not.toHaveBeenCalled();
  });
});
