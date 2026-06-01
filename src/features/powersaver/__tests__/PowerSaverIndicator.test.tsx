/**
 * Unit tests for PowerSaverIndicator (DMY-12).
 *
 * Verifies the status label reflects enabled/active state, the toggle reads and
 * writes the store setting, and the surface is styled from the DARK/AOD tokens
 * (the night-time baby-unit face).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import PowerSaverIndicator from '../PowerSaverIndicator';
import { DARK_COLORS } from '../../../theme';
import { useAppStore } from '../../../store/useAppStore';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

describe('PowerSaverIndicator', () => {
  beforeEach(() => {
    __resetAllMmkv();
    useAppStore.getState().reset();
  });

  it('shows the dimmed label when enabled and active', () => {
    render(<PowerSaverIndicator active={true} />);
    expect(screen.getByText(/screen dimmed/i)).toBeTruthy();
  });

  it('shows the standby label when enabled but not active', () => {
    render(<PowerSaverIndicator active={false} />);
    expect(screen.getByText(/standby/i)).toBeTruthy();
  });

  it('shows the off label when disabled in settings', () => {
    useAppStore.getState().setPowerSaverEnabled(false);
    render(<PowerSaverIndicator active={false} />);
    expect(screen.getByText('Power-saver off')).toBeTruthy();
  });

  it('reflects the enabled setting on the toggle', () => {
    render(<PowerSaverIndicator active={true} />);
    expect(screen.getByTestId('power-saver-toggle').props.value).toBe(true);
  });

  it('writes the store setting when the toggle is flipped off', () => {
    render(<PowerSaverIndicator active={true} />);
    fireEvent(screen.getByTestId('power-saver-toggle'), 'valueChange', false);
    expect(useAppStore.getState().settings.powerSaverEnabled).toBe(false);
  });

  it('renders against the dark/AOD palette (night-time face)', () => {
    render(<PowerSaverIndicator active={false} />);
    const container = screen.getByTestId('power-saver-indicator');
    expect(container.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: DARK_COLORS.surface }),
      ]),
    );
  });
});
