/**
 * Unit tests for FreeTierLimitBanner (DMY-11).
 *
 * Presentational checks: honest copy is shown, the upgrade CTA is a placeholder
 * that just invokes its handler (no purchase here — DMY-27), and the optional
 * dismiss affordance only appears when wired.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import FreeTierLimitBanner from '../FreeTierLimitBanner';

describe('FreeTierLimitBanner', () => {
  it('renders the honest, non-aggressive limit copy', () => {
    render(<FreeTierLimitBanner />);
    expect(screen.getByText(/used today.+free hour/i)).toBeTruthy();
    // Mentions the daily reset (honest), not a countdown / pressure tactic.
    expect(screen.getByText(/resets at midnight/i)).toBeTruthy();
  });

  it('invokes onUpgradePress when the CTA is tapped (placeholder, no purchase)', () => {
    const onUpgradePress = jest.fn();
    render(<FreeTierLimitBanner onUpgradePress={onUpgradePress} />);
    fireEvent.press(screen.getByTestId('free-tier-upgrade-cta'));
    expect(onUpgradePress).toHaveBeenCalledTimes(1);
  });

  it('still renders the CTA when no handler is provided (inert placeholder)', () => {
    render(<FreeTierLimitBanner />);
    expect(screen.getByTestId('free-tier-upgrade-cta')).toBeTruthy();
    // Pressing without a handler must not throw.
    expect(() =>
      fireEvent.press(screen.getByTestId('free-tier-upgrade-cta')),
    ).not.toThrow();
  });

  it('shows the dismiss affordance only when onDismiss is provided', () => {
    const { rerender } = render(<FreeTierLimitBanner />);
    expect(screen.queryByTestId('free-tier-dismiss')).toBeNull();

    const onDismiss = jest.fn();
    rerender(<FreeTierLimitBanner onDismiss={onDismiss} />);
    fireEvent.press(screen.getByTestId('free-tier-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('exposes the alert role for accessibility', () => {
    render(<FreeTierLimitBanner />);
    const banner = screen.getByTestId('free-tier-limit-banner');
    expect(banner.props.accessibilityRole).toBe('alert');
  });
});
