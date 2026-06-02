/**
 * Screen-level tests for ParentScreen audio routing (DMY-55).
 *
 * Asserts the audio-output toggle: it is HIDDEN until a session is connected;
 * once connected it appears; selecting a route flows through the injected
 * {@link AudioPlayback} controller's `setRoute`; and Bluetooth availability is
 * driven by the controller (hidden when the controller reports none).
 *
 * react-native-vision-camera / permissions / zeroconf are mocked globally
 * (jest.setup.js + __mocks__) so the embedded ParentPairingScreen renders.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ParentScreen from '../ParentScreen';
import { availableRoutesFor } from '../../features/webrtc/audioPlayback';
import type { AudioPlayback } from '../../features/webrtc/audioPlayback';
import type { RootStackScreenProps } from '../../navigation/types';
import { useAppStore } from '../../store/useAppStore';

const { __resetVisionCameraMock } = jest.requireMock(
  'react-native-vision-camera',
) as { __resetVisionCameraMock: () => void };

const { __resetZeroconfMock } = jest.requireMock('react-native-zeroconf') as {
  __resetZeroconfMock: () => void;
};

/** A controller whose methods are jest mocks; Bluetooth toggled per test. */
function fakePlayback(bluetooth = false): AudioPlayback {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    setMuted: jest.fn(),
    setRoute: jest.fn(),
    isBluetoothAvailable: jest.fn(() => bluetooth),
    getAvailableRoutes: jest.fn(() => availableRoutesFor(bluetooth)),
  };
}

/** Minimal navigation/route props for the Parent route. */
const navProps = {
  navigation: {} as never,
  route: { key: 'Parent', name: 'Parent' } as never,
} as RootStackScreenProps<'Parent'>;

function renderParent(playback?: AudioPlayback) {
  return render(<ParentScreen {...navProps} playback={playback} />);
}

describe('ParentScreen — audio route toggle (DMY-55)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetVisionCameraMock();
    __resetZeroconfMock();
    act(() => useAppStore.getState().reset());
  });

  it('hides the toggle until a session is connected', () => {
    renderParent(fakePlayback());
    expect(screen.queryByTestId('audio-route-toggle')).toBeNull();
  });

  it('shows the toggle once the session is connected', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    renderParent(fakePlayback());
    expect(screen.getByTestId('audio-route-toggle')).toBeTruthy();
  });

  it('routes the selection through the controller (setRoute)', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const playback = fakePlayback();
    renderParent(playback);

    fireEvent.press(screen.getByTestId('audio-route-earpiece'));

    expect(playback.setRoute).toHaveBeenCalledWith('earpiece');
    // Selected state is reflected back in the toggle.
    expect(
      screen.getByTestId('audio-route-earpiece').props.accessibilityState
        .selected,
    ).toBe(true);
  });

  it('offers Bluetooth only when the controller reports it available', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));

    const { rerender } = renderParent(fakePlayback(false));
    expect(screen.queryByTestId('audio-route-bluetooth')).toBeNull();

    rerender(<ParentScreen {...navProps} playback={fakePlayback(true)} />);
    expect(screen.getByTestId('audio-route-bluetooth')).toBeTruthy();
  });

  it('falls back to a safe no-op controller when none is injected', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    // No playback prop -> noop controller -> Bluetooth hidden, no crash on press.
    renderParent();
    expect(screen.getByTestId('audio-route-toggle')).toBeTruthy();
    expect(screen.queryByTestId('audio-route-bluetooth')).toBeNull();
    expect(() =>
      fireEvent.press(screen.getByTestId('audio-route-earpiece')),
    ).not.toThrow();
  });
});
