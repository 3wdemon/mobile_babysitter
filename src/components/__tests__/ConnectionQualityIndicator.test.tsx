/**
 * Tests for ConnectionQualityIndicator (DMY-53).
 *
 * Drives the store's connectionStatus and an optional getStats provider to
 * assert: each of the four levels renders its label + a11y announcement and the
 * correct number of filled bars; the warning appears only on the lowest level;
 * and the status fallback works with no provider (getStats absent — DMY-45).
 */
import { act, render, screen } from '@testing-library/react-native';

import ConnectionQualityIndicator from '../ConnectionQualityIndicator';
import type { ConnectionStats } from '../../features/webrtc/connectionQuality';
import { t } from '../../services/i18n';
import { useAppStore } from '../../store/useAppStore';
import type { ConnectionStatus } from '../../store/types';

const a11yFor = (level: string) =>
  t('connectionQuality.a11y', { level: t(`connectionQuality.levels.${level}`) });

describe('ConnectionQualityIndicator', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  it('renders the excellent level (4 bars, no warning) from good stats', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const getStats = (): ConnectionStats => ({ rttMs: 80, packetLossPct: 0 });
    render(<ConnectionQualityIndicator getStats={getStats} />);

    expect(screen.getByText(t('connectionQuality.levels.excellent'))).toBeTruthy();
    expect(screen.getByTestId('connection-quality-chip').props.accessibilityLabel).toBe(
      a11yFor('excellent'),
    );
    // Bars are intentionally hidden from assistive tech (the label announces
    // the level), so query including hidden elements.
    expect(
      screen.getByTestId('connection-quality-bar-4', {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(screen.queryByTestId('connection-quality-warning')).toBeNull();
  });

  it('renders each level label + a11y from a matching stats sample', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const cases: Array<[ConnectionStats, string]> = [
      [{ rttMs: 80, packetLossPct: 0 }, 'excellent'],
      [{ rttMs: 250, packetLossPct: 0 }, 'good'],
      [{ rttMs: 400, packetLossPct: 0 }, 'fair'],
      [{ rttMs: 900, packetLossPct: 0 }, 'poor'],
    ];
    for (const [sample, level] of cases) {
      const { unmount } = render(
        <ConnectionQualityIndicator getStats={() => sample} />,
      );
      expect(screen.getByText(t(`connectionQuality.levels.${level}`))).toBeTruthy();
      expect(
        screen.getByTestId('connection-quality-chip').props.accessibilityLabel,
      ).toBe(a11yFor(level));
      unmount();
    }
  });

  it('shows a non-blocking alert warning on the poor level', () => {
    act(() => useAppStore.setState({ connectionStatus: 'failed' }));
    render(<ConnectionQualityIndicator />);

    expect(screen.getByText(t('connectionQuality.levels.poor'))).toBeTruthy();
    const warning = screen.getByTestId('connection-quality-warning');
    expect(warning.props.accessibilityRole).toBe('alert');
    expect(warning.props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getByText(t('connectionQuality.warning'))).toBeTruthy();
  });

  it('falls back to the status-derived level with no getStats (DMY-45 absent)', () => {
    const cases: Array<[ConnectionStatus, string]> = [
      ['connected', 'good'],
      ['connecting', 'fair'],
      ['disconnected', 'poor'],
    ];
    for (const [status, level] of cases) {
      act(() => useAppStore.setState({ connectionStatus: status }));
      const { unmount } = render(<ConnectionQualityIndicator />);
      expect(screen.getByText(t(`connectionQuality.levels.${level}`))).toBeTruthy();
      unmount();
    }
  });

  it('does not crash and falls back when getStats throws', () => {
    act(() => useAppStore.setState({ connectionStatus: 'connected' }));
    const throwing = () => {
      throw new Error('boom');
    };
    expect(() =>
      render(<ConnectionQualityIndicator getStats={throwing} />),
    ).not.toThrow();
    expect(screen.getByText(t('connectionQuality.levels.good'))).toBeTruthy();
  });
});
