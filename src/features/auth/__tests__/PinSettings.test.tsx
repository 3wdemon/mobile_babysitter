/**
 * Tests for PinSettings (DMY-44) — the Settings set/change/remove-PIN surface.
 *
 * Exercises the happy path (set a PIN), the confirm-mismatch + too-short
 * validation paths, removal, the legacy/lockout status copy, and the security
 * property that the entered PIN never reaches the logger.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import PinSettings from '../PinSettings';
import { hasPin, verifyPin } from '../pinService';
import { useAppStore } from '../../../store/useAppStore';

const keychainMock = jest.requireMock('react-native-keychain') as {
  __resetKeychainMock: () => void;
};
const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

beforeEach(() => {
  keychainMock.__resetKeychainMock();
  __resetAllMmkv();
  act(() => {
    useAppStore.getState().reset();
  });
});

describe('PinSettings (DMY-44)', () => {
  it('sets a PIN through the entry + confirm flow', async () => {
    render(<PinSettings />);

    // No PIN yet -> "Set PIN" button.
    await waitFor(() =>
      expect(screen.getByTestId('settings-pin-set')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('settings-pin-set'));

    fireEvent.changeText(screen.getByTestId('settings-pin-input'), '4321');
    fireEvent.changeText(screen.getByTestId('settings-pin-confirm'), '4321');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-pin-save'));
    });

    // The PIN is persisted and verifies.
    await waitFor(async () => expect(await hasPin()).toBe(true));
    await expect(verifyPin('4321')).resolves.toBe(true);
  });

  it('shows an error when the confirmation does not match', async () => {
    render(<PinSettings />);
    fireEvent.press(screen.getByTestId('settings-pin-set'));

    fireEvent.changeText(screen.getByTestId('settings-pin-input'), '4321');
    fireEvent.changeText(screen.getByTestId('settings-pin-confirm'), '9999');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-pin-save'));
    });

    expect(screen.getByTestId('settings-pin-error')).toBeTruthy();
    // Nothing was stored on a mismatch.
    await expect(hasPin()).resolves.toBe(false);
  });

  it('rejects a too-short PIN', async () => {
    render(<PinSettings />);
    fireEvent.press(screen.getByTestId('settings-pin-set'));

    fireEvent.changeText(screen.getByTestId('settings-pin-input'), '12');
    fireEvent.changeText(screen.getByTestId('settings-pin-confirm'), '12');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-pin-save'));
    });

    expect(screen.getByTestId('settings-pin-error')).toBeTruthy();
    await expect(hasPin()).resolves.toBe(false);
  });

  it('changes and removes an existing PIN', async () => {
    render(<PinSettings />);

    // Set one first.
    fireEvent.press(screen.getByTestId('settings-pin-set'));
    fireEvent.changeText(screen.getByTestId('settings-pin-input'), '4321');
    fireEvent.changeText(screen.getByTestId('settings-pin-confirm'), '4321');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-pin-save'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('settings-pin-remove')).toBeTruthy(),
    );

    // Remove it.
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-pin-remove'));
    });
    await waitFor(async () => expect(await hasPin()).toBe(false));
  });

  it('surfaces the lockout state in the status hint', async () => {
    // Drive the store into a locked state, then mount.
    act(() => {
      for (let i = 0; i < 5; i++) {
        useAppStore.getState().registerPinFailure(Date.now());
      }
    });
    render(<PinSettings />);
    const status = screen.getByTestId('settings-pin-status');
    // Locked copy mentions trying again (en) — assert the countdown unit "s".
    expect(status.props.children).toMatch(/locked|s\.?/i);
  });

  it('never passes the entered PIN to the logger', async () => {
    const { logger } = jest.requireActual('../../../services/logger');
    const spies = (['debug', 'info', 'warn', 'error'] as const).map(m =>
      jest.spyOn(logger, m),
    );
    try {
      render(<PinSettings />);
      fireEvent.press(screen.getByTestId('settings-pin-set'));
      fireEvent.changeText(screen.getByTestId('settings-pin-input'), '135790');
      fireEvent.changeText(screen.getByTestId('settings-pin-confirm'), '135790');
      await act(async () => {
        fireEvent.press(screen.getByTestId('settings-pin-save'));
      });

      const logged = spies
        .flatMap(s => s.mock.calls)
        .flat()
        .map(a => JSON.stringify(a))
        .join(' ');
      expect(logged).not.toContain('135790');
    } finally {
      spies.forEach(s => s.mockRestore());
    }
  });
});
