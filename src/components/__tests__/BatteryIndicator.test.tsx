/**
 * Tests for BatteryIndicator (DMY-54).
 *
 * Drives an explicit fake BatterySource (so no native code is touched) and
 * asserts: the percent + charging glyph render, the low-battery warning appears
 * only when `isLow`, and the UNKNOWN (noop) state degrades to a neutral chip
 * with no warning.
 */
import { render, screen } from '@testing-library/react-native';

import BatteryIndicator from '../BatteryIndicator';
import {
  UNKNOWN_BATTERY_STATE,
  makeBatteryState,
  type BatterySource,
  type BatteryState,
} from '../../features/powersaver/batteryStatus';
import { t } from '../../services/i18n';

/** A static fake source that emits one snapshot and never changes. */
function staticSource(state: BatteryState): BatterySource {
  return {
    subscribe: listener => {
      listener(state);
      return () => {};
    },
    getCurrent: () => state,
  };
}

describe('BatteryIndicator', () => {
  it('renders the percent and an a11y label for a healthy off-charger level', () => {
    render(<BatteryIndicator source={staticSource(makeBatteryState(0.85, false))} />);

    expect(screen.getByTestId('battery-level').props.children).toBe('85%');
    expect(screen.getByTestId('battery-chip').props.accessibilityLabel).toBe(
      t('battery.a11y', { percent: '85%', state: t('battery.onBattery') }),
    );
    expect(screen.queryByTestId('battery-charging-glyph')).toBeNull();
    expect(screen.queryByTestId('battery-warning')).toBeNull();
  });

  it('rounds the percent to a whole number', () => {
    render(<BatteryIndicator source={staticSource(makeBatteryState(0.187, false))} />);
    // 0.187 -> 19% (still < 20% so it is also low, but we only assert text here)
    expect(screen.getByTestId('battery-level').props.children).toBe('19%');
  });

  it('shows the charging glyph and charging a11y state when charging', () => {
    render(<BatteryIndicator source={staticSource(makeBatteryState(0.4, true))} />);

    expect(
      screen.getByTestId('battery-charging-glyph', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByTestId('battery-chip').props.accessibilityLabel).toBe(
      t('battery.a11y', { percent: '40%', state: t('battery.charging') }),
    );
  });

  it('shows the low-battery warning (alert) below 20% and off-charger', () => {
    render(<BatteryIndicator source={staticSource(makeBatteryState(0.15, false))} />);

    const warning = screen.getByTestId('battery-warning');
    expect(warning.props.children).toBe(t('battery.lowWarning'));
    expect(warning.props.accessibilityRole).toBe('alert');
  });

  it('suppresses the warning while charging even at a low level', () => {
    render(<BatteryIndicator source={staticSource(makeBatteryState(0.1, true))} />);
    expect(screen.queryByTestId('battery-warning')).toBeNull();
  });

  it('renders a neutral chip with no warning for the UNKNOWN (noop) state', () => {
    render(<BatteryIndicator source={staticSource(UNKNOWN_BATTERY_STATE)} />);

    expect(screen.getByTestId('battery-level').props.children).toBe(
      t('battery.unknown'),
    );
    expect(screen.getByTestId('battery-chip').props.accessibilityLabel).toBe(
      t('battery.a11yUnknown'),
    );
    expect(screen.queryByTestId('battery-charging-glyph')).toBeNull();
    expect(screen.queryByTestId('battery-warning')).toBeNull();
  });
});
