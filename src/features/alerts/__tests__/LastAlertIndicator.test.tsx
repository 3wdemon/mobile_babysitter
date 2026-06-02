/**
 * Unit tests for LastAlertIndicator (DMY-26).
 *
 * Pure presentational checks: it shows the per-type label, an empty state, and
 * never renders any media (the AlertEvent carries none).
 */
import { render, screen } from '@testing-library/react-native';

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
});
