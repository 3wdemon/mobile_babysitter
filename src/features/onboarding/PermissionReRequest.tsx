/**
 * PermissionReRequest — re-request UI with "open settings" guidance (DMY-57).
 *
 * A reusable surface for the post-onboarding world: once the initial
 * {@link PermissionsScreen} (DMY-42) flow is done, a permission can still be
 * `denied` (re-requestable) or `blocked` (only Settings can change it). This
 * component renders, per still-needed permission, the right affordance:
 *
 *  - `denied`  -> a "Grant" button calling {@link usePermissions.request} (the
 *    OS will re-prompt).
 *  - `blocked` -> guidance copy + an "Open settings" button calling
 *    {@link usePermissions.openSettings} (the only way to change a blocked
 *    permission).
 *
 * When every REQUIRED permission is granted the re-request UI is suppressed and
 * the optional `onAllGranted` continue affordance is shown instead — so a host
 * can use `renderedNothing` semantics (component returns the all-granted state)
 * to know the user may proceed.
 *
 * Host (DMY-57 decision):
 *  - The primary intended host is the Settings screen (DMY-52), which is not
 *    built yet. This component is exported cleanly (default + named) for DMY-52
 *    to drop in.
 *  - It is intentionally self-contained (owns its own `usePermissions`) so it
 *    can ALSO be mounted at session start without permissions by a future host
 *    once a clean, non-fragile mount point exists. We deliberately do NOT wedge
 *    it into ParentScreen/pairing today: those are wrapped in gates and a
 *    pairing flow, so injecting a permission step there would be a fragile,
 *    out-of-scope flow (see PR notes).
 *
 * All colours/spacing/typography come from design tokens via `useTheme`; copy
 * comes from the i18n catalog under `onboarding.permissions.reRequest.*`
 * (reusing the existing `items.*` names and `status.*` labels).
 */
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { usePermissions } from './usePermissions';
import type { AppPermission, PermissionStatus } from './types';

/**
 * Permissions the monitor REQUIRES to function, in display order. `unavailable`
 * permissions are treated as not-required (the device cannot offer them), so
 * they never block "all granted".
 */
const REQUIRED_PERMISSIONS: ReadonlyArray<AppPermission> = [
  'camera',
  'microphone',
  'notifications',
];

/** A required permission is satisfied when granted or simply unavailable. */
function isSatisfied(status: PermissionStatus): boolean {
  return status === 'granted' || status === 'unavailable';
}

export interface PermissionReRequestProps {
  /**
   * Invoked when every required permission is satisfied — both when the user
   * taps the continue affordance and (once) automatically as soon as the
   * statuses reach the all-granted state. Optional: a host that only cares
   * about the rendered UI can omit it.
   */
  onAllGranted?: () => void;
}

/**
 * Re-request / settings-guidance surface. Renders the all-granted state (no
 * per-permission rows) once nothing outstanding remains.
 */
function PermissionReRequest({ onAllGranted }: PermissionReRequestProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { statuses, requesting, request, openSettings } = usePermissions();

  const outstanding = REQUIRED_PERMISSIONS.filter(
    key => !isSatisfied(statuses[key]),
  );
  const allGranted = outstanding.length === 0;

  // Fire the continue callback once when the flow becomes fully granted, so a
  // host that auto-advances (e.g. session start) does not need to poll.
  useEffect(() => {
    if (allGranted) {
      onAllGranted?.();
    }
  }, [allGranted, onAllGranted]);

  const requestButtonOpacity = requesting ? 0.6 : 1;

  const statusLabel = (status: PermissionStatus): string =>
    t(`onboarding.permissions.status.${status}`);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      testID="permission-re-request">
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
          {allGranted
            ? t('onboarding.permissions.reRequest.allGranted')
            : t('onboarding.permissions.reRequest.title')}
        </Text>

        {!allGranted && (
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
            {t('onboarding.permissions.reRequest.subtitle')}
          </Text>
        )}

        {outstanding.map(key => {
          const status = statuses[key];
          const isBlocked = status === 'blocked';
          const permissionTitle = t(
            `onboarding.permissions.items.${key}.title`,
          );

          return (
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
                {permissionTitle}
              </Text>

              <Text
                accessibilityLabel={t('onboarding.permissions.statusA11y', {
                  title: permissionTitle,
                  status: statusLabel(status),
                })}
                style={[
                  styles.guidance,
                  {
                    color: isBlocked
                      ? theme.colors.danger
                      : theme.colors.textMuted,
                    fontSize: theme.typography.fontSizes.sm,
                    lineHeight: theme.typography.lineHeights.sm,
                    marginBottom: theme.spacing.md,
                  },
                ]}>
                {isBlocked
                  ? t('onboarding.permissions.reRequest.blockedGuidance')
                  : t('onboarding.permissions.reRequest.deniedGuidance')}
              </Text>

              {isBlocked ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    'onboarding.permissions.reRequest.openSettingsA11y',
                    { title: permissionTitle },
                  )}
                  style={[
                    styles.action,
                    {
                      borderColor: theme.colors.primary,
                      borderRadius: theme.spacing.sm,
                      paddingVertical: theme.spacing.md,
                    },
                  ]}
                  onPress={openSettings}>
                  <Text
                    style={[
                      styles.actionLabel,
                      {
                        color: theme.colors.primary,
                        fontSize: theme.typography.fontSizes.sm,
                        fontWeight: theme.typography.fontWeights.semibold,
                      },
                    ]}>
                    {t('onboarding.permissions.reRequest.openSettings')}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityState={{ disabled: requesting }}
                  accessibilityLabel={t(
                    'onboarding.permissions.reRequest.grantA11y',
                    { title: permissionTitle },
                  )}
                  disabled={requesting}
                  style={[
                    styles.actionPrimary,
                    {
                      backgroundColor: theme.colors.primary,
                      borderRadius: theme.spacing.sm,
                      paddingVertical: theme.spacing.md,
                      opacity: requestButtonOpacity,
                    },
                  ]}
                  onPress={request}>
                  <Text
                    style={[
                      styles.actionLabel,
                      {
                        color: theme.colors.onPrimary,
                        fontSize: theme.typography.fontSizes.sm,
                        fontWeight: theme.typography.fontWeights.semibold,
                      },
                    ]}>
                    {requesting
                      ? t('onboarding.permissions.requesting')
                      : t('onboarding.permissions.reRequest.grant')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>

      {allGranted && (
        <View
          style={[
            styles.footer,
            {
              padding: theme.spacing.xl,
              borderTopColor: theme.colors.border,
            },
          ]}>
          <TouchableOpacity
            accessibilityRole="button"
            style={[
              styles.actionPrimary,
              {
                backgroundColor: theme.colors.primary,
                borderRadius: theme.spacing.sm,
                paddingVertical: theme.spacing.lg,
              },
            ]}
            onPress={() => onAllGranted?.()}>
            <Text
              style={[
                styles.actionLabel,
                {
                  color: theme.colors.onPrimary,
                  fontSize: theme.typography.fontSizes.md,
                  fontWeight: theme.typography.fontWeights.semibold,
                },
              ]}>
              {t('onboarding.permissions.reRequest.continue')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
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
  guidance: {},
  action: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionPrimary: {
    alignItems: 'center',
  },
  actionLabel: {},
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

export default PermissionReRequest;
