/**
 * Screen integration test for the offline indicator (DMY-60).
 *
 * Proves the wiring end-to-end: with the SHARED network source overridden to a
 * fake, the BabyScreen renders the offline banner the moment the source reports
 * offline, and removes it when it recovers. Uses the public `__setNetworkSource`
 * seam so no component prop-drilling is required — exactly how the screen
 * resolves its source in production.
 */
import { act, render, screen, waitFor } from '@testing-library/react-native';

import BabyScreen from '../BabyScreen';
import { t } from '../../services/i18n';
import {
  ONLINE_STATE,
  __setNetworkSource,
  type NetworkListener,
  type NetworkSource,
  type NetworkState,
} from '../../services/network';
import { useAppStore } from '../../store/useAppStore';
import type { RootStackScreenProps } from '../../navigation/types';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

function createFakeSource() {
  let current: NetworkState = ONLINE_STATE;
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

// BabyScreen takes navigation props it doesn't use in this path.
const navProps = {} as unknown as RootStackScreenProps<'Baby'>;

beforeEach(() => {
  __resetAllMmkv();
  act(() => {
    useAppStore.getState().reset();
  });
});

afterEach(() => {
  __setNetworkSource(null);
});

describe('BabyScreen + OfflineIndicator (DMY-60)', () => {
  it('shows the banner when the shared source reports offline, hides it on recovery', async () => {
    const fake = createFakeSource();
    __setNetworkSource(fake.source);

    render(<BabyScreen {...navProps} />);

    // Online by default -> no banner.
    await waitFor(() => {
      expect(screen.getByTestId('pairing-qr')).toBeTruthy();
    });
    expect(screen.queryByTestId('offline-indicator')).toBeNull();

    // Source goes offline -> banner appears with the catalog copy.
    act(() => fake.emit({ isOnline: false, type: 'none' }));
    const banner = screen.getByTestId('offline-indicator');
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(screen.getByText(t('network.offline'))).toBeTruthy();

    // Recovery -> banner disappears.
    act(() => fake.emit({ isOnline: true, type: 'wifi' }));
    expect(screen.queryByTestId('offline-indicator')).toBeNull();
  });
});
