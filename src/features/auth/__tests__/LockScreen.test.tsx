import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import LockScreen from '../screens/LockScreen';
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

describe('LockScreen (DMY-10)', () => {
  beforeEach(() => {
    bioMock.__resetBiometricsMock();
    keychainMock.__resetKeychainMock();
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
});
