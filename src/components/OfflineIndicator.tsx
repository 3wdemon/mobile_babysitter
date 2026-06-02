/**
 * OfflineIndicator — a top banner shown only while the device is offline (DMY-60).
 *
 * Mobile Babysitter is P2P-only: if the device has no usable network, the
 * monitor cannot reach the peer, so we surface that prominently. The banner
 * reads the shared network source via {@link useNetworkStatus} and renders
 * NOTHING while online (so it is non-intrusive on the happy path).
 *
 * Accessibility: the banner is an `alert` live region — when it appears,
 * assistive tech announces it ("polite"/role=alert), which is the right urgency
 * for "you've lost your connection to the baby unit". All colours/typography/
 * spacing come from design tokens via `useTheme`; the copy comes from the i18n
 * catalog (`network.offline`).
 */
import { StyleSheet, Text, View } from 'react-native';

import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import type { ThemeMode } from '../theme';
import type { NetworkSource } from '../services/network';

export interface OfflineIndicatorProps {
  /** Theme selection passed through to `useTheme` (e.g. `'dark'` on the baby face). */
  readonly mode?: ThemeMode;
  /** Optional explicit network source (mainly for tests). */
  readonly source?: NetworkSource;
}

function OfflineIndicator({ mode = 'system', source }: OfflineIndicatorProps) {
  const theme = useTheme(mode);
  const { t } = useTranslation();
  const { isOnline } = useNetworkStatus(source);

  // Online is the happy path: render nothing so the banner never gets in the
  // way during normal monitoring.
  if (isOnline) {
    return null;
  }

  const label = t('network.offline');

  return (
    <View
      testID="offline-indicator"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.danger,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          {
            color: theme.colors.onPrimary,
            fontSize: theme.typography.fontSizes.sm,
            fontWeight: theme.typography.fontWeights.semibold,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  label: {
    textAlign: 'center',
  },
});

export default OfflineIndicator;
