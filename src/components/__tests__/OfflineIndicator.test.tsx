/**
 * Tests for OfflineIndicator (DMY-60).
 *
 * Drives a fake NetworkSource: the banner is hidden while online and shown,
 * labelled and announced as an alert live region while offline.
 */
import { act, render, screen } from '@testing-library/react-native';

import OfflineIndicator from '../OfflineIndicator';
import { t } from '../../services/i18n';
import {
  ONLINE_STATE,
  type NetworkListener,
  type NetworkSource,
  type NetworkState,
} from '../../services/network';

function createFakeSource(initial: NetworkState = ONLINE_STATE) {
  let current = initial;
  let listener: NetworkListener | null = null;
  const source: NetworkSource = {
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
    emit(state: NetworkState) {
      current = state;
      listener?.(state);
    },
  };
}

describe('OfflineIndicator', () => {
  it('renders nothing while online', () => {
    const fake = createFakeSource();
    render(<OfflineIndicator source={fake.source} />);
    expect(screen.queryByTestId('offline-indicator')).toBeNull();
  });

  it('shows a labelled alert banner while offline', () => {
    const fake = createFakeSource({ isOnline: false, type: 'none' });
    render(<OfflineIndicator source={fake.source} />);

    const node = screen.getByTestId('offline-indicator');
    expect(node).toBeTruthy();
    expect(node.props.accessibilityRole).toBe('alert');
    expect(node.props.accessibilityLiveRegion).toBe('polite');
    // i18n catalog copy, not a hard-coded string.
    expect(node.props.accessibilityLabel).toBe(t('network.offline'));
    expect(screen.getByText(t('network.offline'))).toBeTruthy();
  });

  it('appears when the source goes offline and disappears when back online', () => {
    const fake = createFakeSource();
    render(<OfflineIndicator source={fake.source} />);
    expect(screen.queryByTestId('offline-indicator')).toBeNull();

    act(() => fake.emit({ isOnline: false, type: 'none' }));
    expect(screen.getByTestId('offline-indicator')).toBeTruthy();

    act(() => fake.emit({ isOnline: true, type: 'wifi' }));
    expect(screen.queryByTestId('offline-indicator')).toBeNull();
  });
});
