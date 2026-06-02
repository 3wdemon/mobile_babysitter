/**
 * RoleSelectScreen — final onboarding step (DMY-42).
 *
 * The user picks this device's role for the pairing session: the **Baby unit**
 * (the phone left with the baby that streams audio/video) or the **Parent
 * unit** (the phone that watches/listens). Selecting either one is the end of
 * onboarding: it persists the role and flips `onboardingCompleted` in the app
 * store, after which the RootNavigator routes straight to the matching screen
 * on this and every future launch.
 *
 * All colours/typography come from design tokens via `useTheme`.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../../../hooks/useTheme';
import { useTranslation } from '../../../hooks/useTranslation';
import { useAppStore } from '../../../store/useAppStore';
import { logger } from '../../../services/logger';
import type { Role } from '../../../store/types';
import type { OnboardingScreenProps } from '../types';

/**
 * The two selectable roles. Each role doubles as its catalog key under
 * `onboarding.roleSelect.options.*` (DMY-63); the copy lives in the catalogs.
 */
const ROLE_OPTIONS: ReadonlyArray<Exclude<Role, null>> = ['baby', 'parent'];

function RoleSelectScreen(_props: OnboardingScreenProps<'RoleSelect'>) {
  const theme = useTheme();
  const { t } = useTranslation();
  const setRole = useAppStore(s => s.setRole);
  const completeOnboarding = useAppStore(s => s.completeOnboarding);

  const onSelect = (role: Exclude<Role, null>) => {
    setRole(role);
    completeOnboarding();
    logger.info('onboarding: role selected', { role });
    // No manual navigation: once `onboardingCompleted` is true the
    // RootNavigator swaps the onboarding stack for the role-specific screen.
  };

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View
        style={[styles.content, { paddingHorizontal: theme.spacing.xl }]}>
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
          {t('onboarding.roleSelect.title')}
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
          {t('onboarding.roleSelect.subtitle')}
        </Text>

        {ROLE_OPTIONS.map(role => (
          <TouchableOpacity
            key={role}
            accessibilityRole="button"
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.spacing.md,
                padding: theme.spacing.lg,
                marginBottom: theme.spacing.md,
              },
            ]}
            onPress={() => onSelect(role)}>
            <Text
              style={[
                styles.cardTitle,
                {
                  color: theme.colors.text,
                  fontSize: theme.typography.fontSizes.lg,
                  fontWeight: theme.typography.fontWeights.semibold,
                  lineHeight: theme.typography.lineHeights.lg,
                  marginBottom: theme.spacing.xs,
                },
              ]}>
              {t(`onboarding.roleSelect.options.${role}.title`)}
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
              {t(`onboarding.roleSelect.options.${role}.body`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {},
  subtitle: {},
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardTitle: {},
  cardBody: {},
});

export default RoleSelectScreen;
