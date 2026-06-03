/**
 * Unit tests for FreeTierLimitBanner (DMY-11, DMY-51).
 *
 * Presentational checks: honest copy is shown, the upgrade CTA is a placeholder
 * that just invokes its handler (no purchase here — DMY-27), and the optional
 * dismiss affordance only appears when wired.
 *
 * FREE_MODE (DMY-51): the MVP default `FREE_MODE = true` hides the paywall, so
 * the banner renders nothing. The DMY-11 presentational tests therefore inject
 * `freeMode={false}` (the DMY-27 cutover) to render the surface; a dedicated
 * block asserts the FREE_MODE-on render is null.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import FreeTierLimitBanner from '../FreeTierLimitBanner';

describe('FreeTierLimitBanner (FREE_MODE off — DMY-11 surface)', () => {
  it('renders the honest, non-aggressive limit copy', () => {
    render(<FreeTierLimitBanner freeMode={false} />);
    expect(screen.getByText(/used today.+free hour/i)).toBeTruthy();
    // Mentions the daily reset (honest), not a countdown / pressure tactic.
    expect(screen.getByText(/resets at midnight/i)).toBeTruthy();
  });

  it('invokes onUpgradePress when the CTA is tapped (placeholder, no purchase)', () => {
    const onUpgradePress = jest.fn();
    render(
      <FreeTierLimitBanner freeMode={false} onUpgradePress={onUpgradePress} />,
    );
    fireEvent.press(screen.getByTestId('free-tier-upgrade-cta'));
    expect(onUpgradePress).toHaveBeenCalledTimes(1);
  });

  it('still renders the CTA when no handler is provided (inert placeholder)', () => {
    render(<FreeTierLimitBanner freeMode={false} />);
    expect(screen.getByTestId('free-tier-upgrade-cta')).toBeTruthy();
    // Pressing without a handler must not throw.
    expect(() =>
      fireEvent.press(screen.getByTestId('free-tier-upgrade-cta')),
    ).not.toThrow();
  });

  it('shows the dismiss affordance only when onDismiss is provided', () => {
    const { rerender } = render(<FreeTierLimitBanner freeMode={false} />);
    expect(screen.queryByTestId('free-tier-dismiss')).toBeNull();

    const onDismiss = jest.fn();
    rerender(<FreeTierLimitBanner freeMode={false} onDismiss={onDismiss} />);
    fireEvent.press(screen.getByTestId('free-tier-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('exposes the alert role for accessibility', () => {
    render(<FreeTierLimitBanner freeMode={false} />);
    const banner = screen.getByTestId('free-tier-limit-banner');
    expect(banner.props.accessibilityRole).toBe('alert');
  });
});

describe('FreeTierLimitBanner under FREE_MODE (DMY-51)', () => {
  it('renders nothing when freeMode is on (no paywall surface)', () => {
    const { toJSON } = render(<FreeTierLimitBanner freeMode />);
    expect(toJSON()).toBeNull();
    expect(screen.queryByTestId('free-tier-limit-banner')).toBeNull();
    expect(screen.queryByTestId('free-tier-upgrade-cta')).toBeNull();
  });

  it('defaults to the module FREE_MODE flag (MVP default hides the banner)', () => {
    // No freeMode prop -> uses FREE_MODE (true on the MVP), so nothing renders.
    const { toJSON } = render(<FreeTierLimitBanner />);
    expect(toJSON()).toBeNull();
  });
});
