/**
 * Tests for AudioRouteToggle (DMY-55).
 *
 * Asserts: it renders the three output routes (speaker/earpiece/bluetooth) when
 * all are available; the Bluetooth segment is hidden when unavailable (with an
 * explanatory hint); pressing a segment calls onSelectRoute with the right
 * route; and the selected route is reflected in `accessibilityState.selected`
 * plus the selected-state a11y label.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import AudioRouteToggle from '../AudioRouteToggle';
import { availableRoutesFor } from '../../features/webrtc/audioPlayback';
import { t } from '../../services/i18n';

describe('AudioRouteToggle', () => {
  it('renders all three routes when Bluetooth is available', () => {
    render(
      <AudioRouteToggle
        selectedRoute="speaker"
        availableRoutes={availableRoutesFor(true)}
        onSelectRoute={jest.fn()}
      />,
    );

    expect(screen.getByTestId('audio-route-speaker')).toBeTruthy();
    expect(screen.getByTestId('audio-route-earpiece')).toBeTruthy();
    expect(screen.getByTestId('audio-route-bluetooth')).toBeTruthy();
    // No "unavailable" hint when Bluetooth IS available.
    expect(screen.queryByTestId('audio-route-bluetooth-hint')).toBeNull();
  });

  it('hides the Bluetooth option (with a hint) when unavailable', () => {
    render(
      <AudioRouteToggle
        selectedRoute="speaker"
        availableRoutes={availableRoutesFor(false)}
        onSelectRoute={jest.fn()}
      />,
    );

    expect(screen.getByTestId('audio-route-speaker')).toBeTruthy();
    expect(screen.getByTestId('audio-route-earpiece')).toBeTruthy();
    expect(screen.queryByTestId('audio-route-bluetooth')).toBeNull();
    expect(
      screen.getByText(t('audioRoute.bluetoothUnavailable')),
    ).toBeTruthy();
  });

  it('calls onSelectRoute with the pressed route', () => {
    const onSelectRoute = jest.fn();
    render(
      <AudioRouteToggle
        selectedRoute="speaker"
        availableRoutes={availableRoutesFor(true)}
        onSelectRoute={onSelectRoute}
      />,
    );

    fireEvent.press(screen.getByTestId('audio-route-speaker'));
    expect(onSelectRoute).toHaveBeenCalledWith('speaker');

    fireEvent.press(screen.getByTestId('audio-route-earpiece'));
    expect(onSelectRoute).toHaveBeenCalledWith('earpiece');

    fireEvent.press(screen.getByTestId('audio-route-bluetooth'));
    expect(onSelectRoute).toHaveBeenCalledWith('bluetooth');
  });

  it('still fires onSelectRoute when the already-selected route is pressed', () => {
    const onSelectRoute = jest.fn();
    render(
      <AudioRouteToggle
        selectedRoute="speaker"
        availableRoutes={availableRoutesFor(true)}
        onSelectRoute={onSelectRoute}
      />,
    );

    fireEvent.press(screen.getByTestId('audio-route-speaker'));
    expect(onSelectRoute).toHaveBeenCalledWith('speaker');
  });

  it('reflects the selected route in accessibilityState + a11y label', () => {
    render(
      <AudioRouteToggle
        selectedRoute="earpiece"
        availableRoutes={availableRoutesFor(true)}
        onSelectRoute={jest.fn()}
      />,
    );

    const earpiece = screen.getByTestId('audio-route-earpiece');
    const speaker = screen.getByTestId('audio-route-speaker');

    expect(earpiece.props.accessibilityState.selected).toBe(true);
    expect(speaker.props.accessibilityState.selected).toBe(false);

    const earpieceLabel = t('audioRoute.routes.earpiece');
    expect(earpiece.props.accessibilityLabel).toBe(
      t('audioRoute.selectedA11y', { label: earpieceLabel }),
    );
    expect(speaker.props.accessibilityLabel).toBe(
      t('audioRoute.optionA11y', {
        label: t('audioRoute.routes.speaker'),
      }),
    );
  });

  it('defaults to every route when availableRoutes is omitted', () => {
    render(
      <AudioRouteToggle selectedRoute="speaker" onSelectRoute={jest.fn()} />,
    );
    expect(screen.getByTestId('audio-route-bluetooth')).toBeTruthy();
  });
});
