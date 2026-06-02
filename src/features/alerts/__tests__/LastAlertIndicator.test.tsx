/**
 * Unit tests for LastAlertIndicator (DMY-26).
 *
 * Pure presentational checks: it shows the per-type label, an empty state, and
 * never renders any media (the AlertEvent carries none).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import LastAlertIndicator from '../LastAlertIndicator';
import { soundIdForType } from '../alertSoundMap';
import type { AlertEvent } from '../alertTypes';

function makeAlert(type: AlertEvent['type']): AlertEvent {
  return { type, timestamp: 1000, soundId: soundIdForType(type) };
}

describe('LastAlertIndicator', () => {
  it('shows the empty state when there is no alert', () => {
    render(<LastAlertIndicator alert={null} />);
    expect(screen.getByText('No alerts yet')).toBeTruthy();
  });

  it('shows the per-type label for each alert type', () => {
    const cases: Array<[AlertEvent['type'], string]> = [
      ['cry', 'Crying'],
      ['motion', 'Movement'],
      ['noise', 'Noise'],
      ['no_motion', 'No movement'],
    ];
    for (const [type, label] of cases) {
      const { unmount } = render(<LastAlertIndicator alert={makeAlert(type)} />);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  it('exposes an accessibility label naming the last alert', () => {
    render(<LastAlertIndicator alert={makeAlert('cry')} />);
    expect(screen.getByLabelText('Last alert: Crying')).toBeTruthy();
  });

  it('shows a snooze badge with the HH:MM deadline when snoozed (DMY-28)', () => {
    // 2026-06-02T08:05 local time.
    const until = new Date(2026, 5, 2, 8, 5).getTime();
    render(<LastAlertIndicator alert={makeAlert('cry')} snoozedUntil={until} />);
    expect(screen.getByTestId('snooze-badge')).toBeTruthy();
    expect(screen.getByText('Snoozed until 08:05')).toBeTruthy();
    expect(screen.getByLabelText('Alerts snoozed until 08:05')).toBeTruthy();
  });

  it('renders no snooze badge when not snoozed', () => {
    render(<LastAlertIndicator alert={makeAlert('noise')} />);
    expect(screen.queryByTestId('snooze-badge')).toBeNull();
  });

  it('triggers the snooze gesture on long-press (DMY-28)', () => {
    const onSnoozeGesture = jest.fn();
    render(
      <LastAlertIndicator
        alert={makeAlert('noise')}
        onSnoozeGesture={onSnoozeGesture}
      />,
    );
    fireEvent(screen.getByTestId('last-alert-indicator'), 'longPress');
    expect(onSnoozeGesture).toHaveBeenCalledTimes(1);
  });

  it('renders as a non-interactive view without onSnoozeGesture', () => {
    render(<LastAlertIndicator alert={makeAlert('noise')} />);
    fireEvent(screen.getByTestId('last-alert-indicator'), 'longPress');
    // No handler wired -> nothing to assert beyond not throwing.
    expect(screen.getByText('Noise')).toBeTruthy();
  });
});
