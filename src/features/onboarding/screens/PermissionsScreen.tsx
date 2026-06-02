/**
 * PermissionsScreen — second onboarding step (DMY-42).
 *
 * Explains, per permission, WHY the baby monitor needs camera, microphone and
 * notifications (with the privacy framing: media stays on-device / P2P). The
 * primary button requests all three via {@link usePermissions}; the result is
 * shown inline. Crucially the flow is non-blocking: whether the user grants,
 * denies or blocks, `Continue` always advances to role selection — denied
 * permissions can be granted later from system Settings.
 *
 * All colours/typography come from design tokens via `useTheme`.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../../../hooks/useTheme';
import { useTranslation } from '../../../hooks/useTranslation';
import { usePermissions } from '../usePermissions';
import type { AppPermission, PermissionStatus, OnboardingScreenProps } from '../types';

/**
 * Permissions shown on the screen, in display order. Each key doubles as its
 * catalog key under `onboarding.permissions.items.*` (DMY-63); the rationale
 * copy lives in the locale catalogs.
 */
const PERMISSION_KEYS: ReadonlyArray<AppPermission> = [
  'camera',
  'microphone',
  'notifications',
];

function PermissionsScreen({ navigation }: OnboardingScreenProps<'Permissions'>) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { statuses, requesting, request } = usePermissions();
  const [hasRequested, setHasRequested] = useState(false);

  /** Localised label for a permission status, shown inline after a request. */
  const statusLabel = (status: PermissionStatus): string =>
    t(`onboarding.permissions.status.${status}`);

  const onRequest = async () => {
    await request();
    // Even if some permissions are denied/blocked we still mark that the user
    // responded, so the inline statuses render and the copy can switch to
    // "you can continue regardless".
    setHasRequested(true);
  };

  // Precomputed so the dynamic style below holds no literal style values
  // (keeps react-native/no-inline-styles happy).
  const requestButtonOpacity = requesting ? 0.6 : 1;

  const statusColor = (status: PermissionStatus): string => {
    switch (status) {
      case 'granted':
        return theme.colors.success;
      case 'blocked':
        return theme.colors.danger;
      default:
        return theme.colors.warning;
    }
  };

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: theme.spacing.xl,
            paddingTop: theme.spacing.xxl,
            paddingBottom: theme.spacing.lg,
          },
        ]}>
        <Text
          accessibilityRole="header"
          style={[
            styles.title,
            {
              color: theme.colors.text,
              fontSize: theme.typography.fontSizes.xl,
              fontWeight: theme.typography.fontWeights.bold,
              lineHeight: theme.typography.lineHeights.xl,
              marginBottom: theme.spacing.sm,
            },
          ]}>
          {t('onboarding.permissions.title')}
        </Text>

        <Text
          style={[
            styles.subtitle,
            {
              color: theme.colors.textMuted,
              fontSize: theme.typography.fontSizes.md,
              lineHeight: theme.typography.lineHeights.md,
              marginBottom: theme.spacing.xl,
            },
          ]}>
          {t('onboarding.permissions.subtitle')}
        </Text>

        {PERMISSION_KEYS.map(key => (
          <View
            key={key}
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.spacing.md,
                padding: theme.spacing.lg,
                marginBottom: theme.spacing.md,
              },
            ]}>
            <Text
              style={[
                styles.cardTitle,
                {
                  color: theme.colors.text,
                  fontSize: theme.typography.fontSizes.md,
                  fontWeight: theme.typography.fontWeights.semibold,
                  lineHeight: theme.typography.lineHeights.md,
                  marginBottom: theme.spacing.xs,
                },
              ]}>
              {t(`onboarding.permissions.items.${key}.title`)}
            </Text>
            <Text
              style={[
                styles.cardBody,
                {
                  color: theme.colors.textMuted,
                  fontSize: theme.typography.fontSizes.sm,
                  lineHeight: theme.typography.lineHeights.sm,
                },
              ]}>
              {t(`onboarding.permissions.items.${key}.body`)}
            </Text>
            {hasRequested && (
              <Text
                accessibilityLabel={t('onboarding.permissions.statusA11y', {
                  title: t(`onboarding.permissions.items.${key}.title`),
                  status: statusLabel(statuses[key]),
                })}
                style={[
                  styles.statusLabel,
                  {
                    color: statusColor(statuses[key]),
                    fontSize: theme.typography.fontSizes.xs,
                    fontWeight: theme.typography.fontWeights.medium,
                    lineHeight: theme.typography.lineHeights.xs,
                    marginTop: theme.spacing.sm,
                  },
                ]}>
                {statusLabel(statuses[key])}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            padding: theme.spacing.xl,
            borderTopColor: theme.colors.border,
          },
        ]}>
        {!hasRequested ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: requesting }}
            disabled={requesting}
            style={[
              styles.button,
              {
                backgroundColor: theme.colors.primary,
                borderRadius: theme.spacing.sm,
                paddingVertical: theme.spacing.lg,
                opacity: requestButtonOpacity,
              },
            ]}
            onPress={onRequest}>
            <Text
              style={[
                styles.buttonLabel,
                {
                  color: theme.colors.onPrimary,
                  fontSize: theme.typography.fontSizes.md,
                  fontWeight: theme.typography.fontWeights.semibold,
                },
              ]}>
              {requesting
                ? t('onboarding.permissions.requesting')
                : t('onboarding.permissions.allowAccess')}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            accessibilityRole="button"
            style={[
              styles.button,
              {
                backgroundColor: theme.colors.primary,
                borderRadius: theme.spacing.sm,
                paddingVertical: theme.spacing.lg,
              },
            ]}
            onPress={() => navigation.navigate('RoleSelect')}>
            <Text
              style={[
                styles.buttonLabel,
                {
                  color: theme.colors.onPrimary,
                  fontSize: theme.typography.fontSizes.md,
                  fontWeight: theme.typography.fontWeights.semibold,
                },
              ]}>
              {t('onboarding.permissions.continue')}
            </Text>
          </TouchableOpacity>
        )}

        {!hasRequested && (
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.skip, { paddingVertical: theme.spacing.md }]}
            onPress={() => navigation.navigate('RoleSelect')}>
            <Text
              style={[
                styles.skipLabel,
                {
                  color: theme.colors.textMuted,
                  fontSize: theme.typography.fontSizes.sm,
                  lineHeight: theme.typography.lineHeights.sm,
                },
              ]}>
              {t('onboarding.permissions.skip')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {},
  title: {},
  subtitle: {},
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardTitle: {},
  cardBody: {},
  statusLabel: {},
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    alignItems: 'center',
  },
  buttonLabel: {},
  skip: {
    alignItems: 'center',
  },
  skipLabel: {},
});

export default PermissionsScreen;
