/**
 * Tests for ReconnectingBanner (DMY-61).
 *
 * The banner is hidden on the happy path, shows "Reconnecting… (attempt N)" while
 * retrying (announced as an alert live region), and on permanent failure shows a
 * "Retry" button wired to onRetry.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import ReconnectingBanner from '../ReconnectingBanner';
import { t } from '../../services/i18n';

describe('ReconnectingBanner', () => {
  it('renders nothing on the happy path (not reconnecting, not failed)', () => {
    render(
      <ReconnectingBanner
        reconnecting={false}
        attempt={0}
        failed={false}
        onRetry={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('reconnecting-banner')).toBeNull();
  });

  it('shows an announced "Reconnecting… (attempt N)" banner while retrying', () => {
    render(
      <ReconnectingBanner
        reconnecting
        attempt={2}
        failed={false}
        onRetry={jest.fn()}
      />,
    );
    const node = screen.getByTestId('reconnecting-banner');
    expect(node.props.accessibilityRole).toBe('alert');
    expect(node.props.accessibilityLiveRegion).toBe('polite');
    const label = t('webrtc.reconnect.retrying', { attempt: 2 });
    expect(label).toContain('2');
    expect(screen.getByText(label)).toBeTruthy();
    // No retry button while still auto-retrying.
    expect(screen.queryByTestId('reconnecting-banner-retry')).toBeNull();
  });

  it('shows a manual Retry button on permanent failure and calls onRetry', () => {
    const onRetry = jest.fn();
    render(
      <ReconnectingBanner
        reconnecting={false}
        attempt={0}
        failed
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(t('webrtc.reconnect.lost'))).toBeTruthy();
    const button = screen.getByTestId('reconnecting-banner-retry');
    expect(button.props.accessibilityRole).toBe('button');
    fireEvent.press(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the exact attempt number while reconnecting and never a retry button', () => {
    // AC: banner shows the correct attempt number; the retry affordance is offered
    // ONLY on permanent failure, not during auto-retry.
    const { rerender } = render(
      <ReconnectingBanner
        reconnecting
        attempt={1}
        failed={false}
        onRetry={jest.fn()}
      />,
    );
    expect(
      screen.getByText(t('webrtc.reconnect.retrying', { attempt: 1 })),
    ).toBeTruthy();
    expect(screen.queryByTestId('reconnecting-banner-retry')).toBeNull();

    rerender(
      <ReconnectingBanner
        reconnecting
        attempt={4}
        failed={false}
        onRetry={jest.fn()}
      />,
    );
    expect(
      screen.getByText(t('webrtc.reconnect.retrying', { attempt: 4 })),
    ).toBeTruthy();
    expect(screen.queryByTestId('reconnecting-banner-retry')).toBeNull();
  });

  it('failed takes precedence over a stale reconnecting flag', () => {
    render(
      <ReconnectingBanner
        reconnecting
        attempt={5}
        failed
        onRetry={jest.fn()}
      />,
    );
    // Failure path → the Retry affordance is shown, not the progress copy.
    expect(screen.getByTestId('reconnecting-banner-retry')).toBeTruthy();
    expect(screen.getByText(t('webrtc.reconnect.lost'))).toBeTruthy();
  });
});
