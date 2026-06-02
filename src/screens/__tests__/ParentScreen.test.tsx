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
    setVolume: jest.fn(),
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

  it('routes every available route (speaker/earpiece/bluetooth) through setRoute', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    // Bluetooth available so all three segments render and are selectable.
    const playback = fakePlayback(true);
    renderParent(playback);

    // Start on the default (speaker); press the other two then back to speaker
    // to exercise the speaker arg explicitly (AC: each of 3 routes -> setRoute).
    fireEvent.press(screen.getByTestId('audio-route-earpiece'));
    fireEvent.press(screen.getByTestId('audio-route-bluetooth'));
    fireEvent.press(screen.getByTestId('audio-route-speaker'));

    expect(playback.setRoute).toHaveBeenNthCalledWith(1, 'earpiece');
    expect(playback.setRoute).toHaveBeenNthCalledWith(2, 'bluetooth');
    expect(playback.setRoute).toHaveBeenNthCalledWith(3, 'speaker');
    // Final selection reflected as the active segment.
    expect(
      screen.getByTestId('audio-route-speaker').props.accessibilityState
        .selected,
    ).toBe(true);
  });

  it('re-routes when the already-selected route is pressed again (idempotent UX)', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const playback = fakePlayback();
    renderParent(playback);

    // Default selection is speaker; press speaker again.
    expect(
      screen.getByTestId('audio-route-speaker').props.accessibilityState
        .selected,
    ).toBe(true);
    fireEvent.press(screen.getByTestId('audio-route-speaker'));

    // Still forwarded to the controller (a no-op switch is the controller's
    // concern) and selection unchanged — no crash, no stale state.
    expect(playback.setRoute).toHaveBeenCalledWith('speaker');
    expect(
      screen.getByTestId('audio-route-speaker').props.accessibilityState
        .selected,
    ).toBe(true);
  });

  it('handles rapid route switching without losing the final selection', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const playback = fakePlayback(true);
    renderParent(playback);

    // Fire a burst of switches back to back.
    fireEvent.press(screen.getByTestId('audio-route-earpiece'));
    fireEvent.press(screen.getByTestId('audio-route-bluetooth'));
    fireEvent.press(screen.getByTestId('audio-route-speaker'));
    fireEvent.press(screen.getByTestId('audio-route-earpiece'));

    expect(playback.setRoute).toHaveBeenCalledTimes(4);
    // The last press wins.
    expect(playback.setRoute).toHaveBeenLastCalledWith('earpiece');
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

  it('does not crash or surface a rejection when setRoute rejects async', async () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const playback = fakePlayback();
    // Simulate a native session that rejects mid-switch (e.g. BT dropped). The
    // screen fires setRoute fire-and-forget; createSafeAudioPlayback absorbs the
    // rejected promise, so nothing here can crash or leave a dangling rejection.
    (playback.setRoute as jest.Mock).mockReturnValue(
      Promise.reject(new Error('native route switch failed')),
    );
    renderParent(playback);

    expect(() =>
      fireEvent.press(screen.getByTestId('audio-route-earpiece')),
    ).not.toThrow();
    // The selection still applies optimistically in the UI.
    expect(
      screen.getByTestId('audio-route-earpiece').props.accessibilityState
        .selected,
    ).toBe(true);
    // Flush microtasks; if the rejection were not swallowed by the wrapper this
    // would log an unhandled rejection and fail the suite.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
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

describe('ParentScreen — playback volume (DMY-56)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetVisionCameraMock();
    __resetZeroconfMock();
    act(() => useAppStore.getState().reset());
  });

  it('hides the volume slider until a session is connected', () => {
    renderParent(fakePlayback());
    expect(screen.queryByTestId('volume-slider')).toBeNull();
  });

  it('shows the volume slider once the session is connected', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    renderParent(fakePlayback());
    expect(screen.getByTestId('volume-slider')).toBeTruthy();
  });

  it('applies the persisted volume to the controller on connect', () => {
    // Restore a non-default persisted volume BEFORE the session connects.
    act(() => {
      useAppStore.getState().setPlaybackVolume(0.25);
      useAppStore.setState({ connectionStatus: 'connected' });
    });
    const playback = fakePlayback();
    renderParent(playback);

    // The restored level is pushed to the controller so it actually takes effect.
    expect(playback.setVolume).toHaveBeenCalledWith(0.25);
  });

  it('changing the slider persists the volume AND applies it to the controller', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const playback = fakePlayback();
    renderParent(playback);

    // Default persisted volume is 1 (full); decrement one step.
    fireEvent.press(screen.getByTestId('volume-decrement'));

    const next = useAppStore.getState().settings.playbackVolume;
    // Persisted in the store (clamped/stepped, within [0,1]).
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThan(1);
    // ...and applied live to the controller with the same value.
    expect(playback.setVolume).toHaveBeenLastCalledWith(next);
  });

  it('does not crash when no controller is injected (safe no-op)', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    renderParent();
    expect(screen.getByTestId('volume-slider')).toBeTruthy();
    expect(() =>
      fireEvent.press(screen.getByTestId('volume-decrement')),
    ).not.toThrow();
  });

  it('re-applies the persisted volume when the session connects AFTER mount', () => {
    // AC: "volume set -> app restart -> playbackVolume restored". Mounting
    // while still idle (no session) must NOT push volume; it is the idle->
    // connected TRANSITION that re-applies the restored level so it takes
    // effect on connect, not just when connected-at-mount.
    act(() => useAppStore.getState().setPlaybackVolume(0.25));
    const playback = fakePlayback();
    renderParent(playback);

    // Idle at mount: nothing applied yet (no audio to attenuate).
    expect(playback.setVolume).not.toHaveBeenCalled();

    // The link comes up -> the persisted level is applied on connect.
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    expect(playback.setVolume).toHaveBeenCalledWith(0.25);
  });

  it('muting then raising never re-handshakes (no start/stop/setRoute, stream stays connected)', () => {
    // AC: "volume 0 -> output muted but stream stays connected (NOT stopped)"
    // plus "raise resumes audibly without re-handshake". Going to 0 and back up
    // must flow ONLY through setVolume on the live controller.
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const playback = fakePlayback();
    renderParent(playback);

    const slider = screen.getByTestId('volume-slider');
    // Drop to mute via the a11y decrement actions (default volume is 1). Each
    // press is its own act() so the store update flushes and the controlled
    // slider re-renders with the new `volume` prop before the next press —
    // otherwise every press reads the same stale step.
    for (let i = 0; i < 4; i += 1) {
      act(() => {
        fireEvent(slider, 'accessibilityAction', {
          nativeEvent: { actionName: 'decrement' },
        });
      });
    }
    expect(useAppStore.getState().settings.playbackVolume).toBe(0);
    expect(playback.setVolume).toHaveBeenLastCalledWith(0);

    // Raise again.
    act(() => {
      fireEvent(slider, 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });
    });
    expect(
      useAppStore.getState().settings.playbackVolume,
    ).toBeGreaterThan(0);

    // The whole mute/raise cycle never tore down or re-established the stream.
    expect(playback.start).not.toHaveBeenCalled();
    expect(playback.stop).not.toHaveBeenCalled();
    expect(playback.setRoute).not.toHaveBeenCalled();
  });
});
