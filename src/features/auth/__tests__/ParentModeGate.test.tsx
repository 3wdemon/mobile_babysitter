import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import ParentModeGate from '../ParentModeGate';
import { useAppStore } from '../../../store/useAppStore';

const bioMock = jest.requireMock('react-native-biometrics') as {
  __resetBiometricsMock: () => void;
  __setSensorAvailable: (available: boolean, type?: string) => void;
  __setNextPromptSuccess: (success: boolean) => void;
};

const keychainMock = jest.requireMock('react-native-keychain') as {
  __resetKeychainMock: () => void;
};

function Protected() {
  return <Text testID="parent-content">PARENT CONTENT</Text>;
}

describe('ParentModeGate (DMY-10)', () => {
  beforeEach(() => {
    bioMock.__resetBiometricsMock();
    keychainMock.__resetKeychainMock();
    act(() => {
      useAppStore.getState().reset();
    });
  });

  it('renders parent content directly when the lock is disabled (default)', () => {
    // Default state: biometricLockEnabled === false.
    render(
      <ParentModeGate>
        <Protected />
      </ParentModeGate>,
    );
    expect(screen.getByTestId('parent-content')).toBeTruthy();
    expect(screen.queryByTestId('lock-screen')).toBeNull();
  });

  it('shows the lock screen (not parent content) when the lock is enabled', async () => {
    act(() => {
      useAppStore.getState().setBiometricLockEnabled(true);
    });
    bioMock.__setSensorAvailable(true, 'FaceID');
    bioMock.__setNextPromptSuccess(false); // stay locked

    render(
      <ParentModeGate>
        <Protected />
      </ParentModeGate>,
    );

    expect(screen.getByTestId('lock-screen')).toBeTruthy();
    // Parent content is gated until unlock.
    await waitFor(() =>
      expect(screen.getByTestId('lock-pin-stage')).toBeTruthy(),
    );
    expect(screen.queryByTestId('parent-content')).toBeNull();
  });

  it('reveals parent content after a successful biometric unlock', async () => {
    act(() => {
      useAppStore.getState().setBiometricLockEnabled(true);
    });
    bioMock.__setSensorAvailable(true, 'FaceID');
    bioMock.__setNextPromptSuccess(true);

    render(
      <ParentModeGate>
        <Protected />
      </ParentModeGate>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('parent-content')).toBeTruthy(),
    );
    expect(screen.queryByTestId('lock-screen')).toBeNull();
  });
});
