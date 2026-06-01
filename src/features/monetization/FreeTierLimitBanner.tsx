/**
 * FreeTierLimitBanner — honest soft-interruption surface for the free tier
 * (DMY-11).
 *
 * Shown after the daily 1h free budget is spent and the session has been gently
 * stopped. The tone is deliberately NON-aggressive (per product-spec: no
 * weekly-paywall pressure, no countdown timer, no auto-charge): it states the
 * limit plainly and offers an optional upgrade.
 *
 * Presentational only. The upgrade button is a PLACEHOLDER — it just invokes
 * `onUpgradePress`; there is NO StoreKit / purchase here (that is DMY-27,
 * blocked-external). All colours/spacing/typography come from `useTheme`; no
 * raw hex.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../hooks/useTheme';

export interface FreeTierLimitBannerProps {
  /**
   * Called when the user taps "See upgrade options". PLACEHOLDER: wire to the
   * real purchase flow in DMY-27. When omitted the CTA is still shown but inert.
   */
  readonly onUpgradePress?: () => void;
  /** Optional dismiss handler; when provided a "Not now" affordance is shown. */
  readonly onDismiss?: () => void;
}

function FreeTierLimitBanner({
  onUpgradePress,
  onDismiss,
}: FreeTierLimitBannerProps) {
  const theme = useTheme();

  return (
    <View
      testID="free-tier-limit-banner"
      accessibilityRole="alert"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.spacing.sm,
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
        },
      ]}
    >
      <Text
        style={[
          styles.title,
          {
            color: theme.colors.text,
            fontSize: theme.typography.fontSizes.lg,
            fontWeight: theme.typography.fontWeights.semibold,
          },
        ]}
      >
        You&apos;ve used today&apos;s free hour
      </Text>

      <Text
        style={[
          styles.body,
          {
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.md,
            lineHeight: theme.typography.lineHeights.md,
          },
        ]}
      >
        The free plan includes one hour of monitoring each day. Your time
        resets at midnight, so you can keep going then at no cost — or upgrade
        for unlimited monitoring whenever you like.
      </Text>

      <Pressable
        testID="free-tier-upgrade-cta"
        accessibilityRole="button"
        onPress={onUpgradePress}
        style={[
          styles.cta,
          {
            backgroundColor: theme.colors.primary,
            borderRadius: theme.spacing.xs,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
          },
        ]}
      >
        <Text
          style={[
            styles.ctaLabel,
            {
              color: theme.colors.onPrimary,
              fontSize: theme.typography.fontSizes.md,
              fontWeight: theme.typography.fontWeights.semibold,
            },
          ]}
        >
          See upgrade options
        </Text>
      </Pressable>

      {onDismiss ? (
        <Pressable
          testID="free-tier-dismiss"
          accessibilityRole="button"
          onPress={onDismiss}
          style={[styles.dismiss, { paddingVertical: theme.spacing.xs }]}
        >
          <Text
            style={[
              styles.dismissLabel,
              {
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSizes.sm,
              },
            ]}
          >
            Not now
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: {},
  body: {},
  cta: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: {},
  dismiss: {
    alignItems: 'center',
  },
  dismissLabel: {},
});

export default FreeTierLimitBanner;
