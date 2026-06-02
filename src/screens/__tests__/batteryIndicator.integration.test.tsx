/**
 * Screen integration test for the battery indicator (DMY-54).
 *
 * Proves the wiring end-to-end: with the SHARED battery source overridden to a
 * fake, BabyScreen renders the battery chip with the reported percent, surfaces
 * the low-battery warning when the source reports a low level off-charger, and
 * clears the warning when the unit is plugged in. Uses the public
 * `__setBatterySource` seam — exactly how the screen resolves its source in
 * production.
 */
import { act, render, screen, waitFor } from '@testing-library/react-native';

import BabyScreen from '../BabyScreen';
import {
  UNKNOWN_BATTERY_STATE,
  __setBatterySource,
  makeBatteryState,
  type BatteryListener,
  type BatterySource,
  type BatteryState,
} from '../../features/powersaver/batteryStatus';
import { t } from '../../services/i18n';
import { useAppStore } from '../../store/useAppStore';
import type { RootStackScreenProps } from '../../navigation/types';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

function createFakeSource(initial: BatteryState = UNKNOWN_BATTERY_STATE) {
  let current = initial;
  let listener: BatteryListener | null = null;
  const source: BatterySource = {
    subscribe: l => {
      listener = l;
      l(current);
      return () => {
        listener = null;
      };
    },
    getCurrent: () => current,
  };
  return {
    source,
    emit(state: BatteryState) {
      current = state;
      listener?.(state);
    },
  };
}

const navProps = {} as unknown as RootStackScreenProps<'Baby'>;

beforeEach(() => {
  __resetAllMmkv();
  act(() => {
    useAppStore.getState().reset();
  });
});

afterEach(() => {
  __setBatterySource(null);
});

describe('BabyScreen + BatteryIndicator (DMY-54)', () => {
  it('renders the battery chip with the reported percent and charging state', async () => {
    const fake = createFakeSource(makeBatteryState(0.72, true));
    __setBatterySource(fake.source);

    render(<BabyScreen {...navProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('battery-indicator')).toBeTruthy();
    });
    expect(screen.getByTestId('battery-level').props.children).toBe('72%');
    expect(
      screen.getByTestId('battery-charging-glyph', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.queryByTestId('battery-warning')).toBeNull();
  });

  it('surfaces the low-battery warning when the source reports low + off-charger, clears on plug-in', async () => {
    const fake = createFakeSource(makeBatteryState(0.5, false));
    __setBatterySource(fake.source);

    render(<BabyScreen {...navProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('battery-indicator')).toBeTruthy();
    });
    expect(screen.queryByTestId('battery-warning')).toBeNull();

    // Drops below 20% off-charger -> warning appears with the catalog copy.
    act(() => fake.emit(makeBatteryState(0.15, false)));
    const warning = screen.getByTestId('battery-warning');
    expect(warning.props.accessibilityRole).toBe('alert');
    expect(screen.getByText(t('battery.lowWarning'))).toBeTruthy();

    // Plugged in at the same level -> warning clears.
    act(() => fake.emit(makeBatteryState(0.15, true)));
    expect(screen.queryByTestId('battery-warning')).toBeNull();
  });

  it('toggles the warning as the level crosses the 20% boundary in both directions (off-charger)', async () => {
    const fake = createFakeSource(makeBatteryState(0.25, false));
    __setBatterySource(fake.source);

    render(<BabyScreen {...navProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('battery-indicator')).toBeTruthy();
    });
    // 25% -> no warning.
    expect(screen.queryByTestId('battery-warning')).toBeNull();

    // Discharge across the boundary: 0.20 (NOT low) -> 0.19 (low).
    act(() => fake.emit(makeBatteryState(0.2, false)));
    expect(screen.queryByTestId('battery-warning')).toBeNull();
    act(() => fake.emit(makeBatteryState(0.19, false)));
    expect(screen.getByTestId('battery-warning')).toBeTruthy();

    // Recover back across the boundary: 0.19 (low) -> 0.20 (NOT low).
    act(() => fake.emit(makeBatteryState(0.2, false)));
    expect(screen.queryByTestId('battery-warning')).toBeNull();
  });

  it('renders a neutral chip (no warning) for the UNKNOWN noop state', async () => {
    const fake = createFakeSource(UNKNOWN_BATTERY_STATE);
    __setBatterySource(fake.source);

    render(<BabyScreen {...navProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('battery-indicator')).toBeTruthy();
    });
    expect(screen.getByTestId('battery-level').props.children).toBe(
      t('battery.unknown'),
    );
    expect(screen.queryByTestId('battery-warning')).toBeNull();
  });
});
