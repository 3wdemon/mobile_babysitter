/**
 * ReconnectingBanner — surfaces P2P auto-reconnect state to the parent (DMY-61).
 *
 * When a previously-connected session drops uncleanly the monitor retries with
 * exponential backoff (see {@link useSignaling}/`reconnectPolicy`). This banner
 * makes that visible so the parent is not left staring at a frozen feed:
 *
 *  - while retrying  → "Reconnecting… (attempt N)" (a warning-toned live region);
 *  - on permanent failure (backoff exhausted) → "Connection lost" + a "Retry"
 *    button that calls `onRetry` (the hook's manual `retry()`); this is the
 *    no-infinite-loop affordance — the app stops auto-retrying and hands control
 *    back to the user;
 *  - otherwise (healthy / connected) → renders NOTHING (non-intrusive happy path).
 *
 * Accessibility: the banner is an `alert` live region so assistive tech announces
 * the state change. All colours/typography/spacing come from design tokens via
 * `useTheme`; copy comes from the i18n catalog (`webrtc.reconnect.*`).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import type { ThemeMode } from '../theme';

export interface ReconnectingBannerProps {
  /** `true` while an auto-reconnect attempt is scheduled / in flight. */
  readonly reconnecting: boolean;
  /** 1-based attempt number shown while reconnecting. */
  readonly attempt: number;
  /** `true` once backoff is exhausted: show the manual-retry affordance. */
  readonly failed: boolean;
  /** Called when the user taps "Retry" after a permanent failure. */
  readonly onRetry: () => void;
  /** Theme selection passed through to `useTheme`. */
  readonly mode?: ThemeMode;
}

function ReconnectingBanner({
  reconnecting,
  attempt,
  failed,
  onRetry,
  mode = 'system',
}: ReconnectingBannerProps) {
  const theme = useTheme(mode);
  const { t } = useTranslation();

  // Healthy / connected is the happy path: render nothing so the banner never
  // gets in the way during normal monitoring. `failed` takes precedence over a
  // stale `reconnecting` flag if both were ever set.
  if (!failed && !reconnecting) {
    return null;
  }

  if (failed) {
    const label = t('webrtc.reconnect.lost');
    const retryLabel = t('webrtc.reconnect.retry');
    return (
      <View
        testID="reconnecting-banner"
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
        <Pressable
          testID="reconnecting-banner-retry"
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          onPress={onRetry}
          style={[
            styles.retry,
            {
              backgroundColor: theme.colors.onPrimary,
              paddingVertical: theme.spacing.xs,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.spacing.xs,
            },
          ]}
        >
          <Text
            style={[
              styles.retryLabel,
              {
                color: theme.colors.danger,
                fontSize: theme.typography.fontSizes.sm,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}
          >
            {retryLabel}
          </Text>
        </Pressable>
      </View>
    );
  }

  // Reconnecting: announce progress with the current attempt number.
  const label = t('webrtc.reconnect.retrying', { attempt });
  return (
    <View
      testID="reconnecting-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.warning,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  label: {
    textAlign: 'center',
  },
  retry: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLabel: {
    textAlign: 'center',
  },
});

export default ReconnectingBanner;
