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
import { useAppStore } from '../../../store/useAppStore';
import { logger } from '../../../services/logger';
import type { Role } from '../../../store/types';
import type { OnboardingScreenProps } from '../types';

/** The two selectable roles plus their explanatory copy. */
const ROLE_OPTIONS: ReadonlyArray<{
  role: Exclude<Role, null>;
  title: string;
  body: string;
}> = [
  {
    role: 'baby',
    title: 'Baby unit',
    body: 'Leave this phone with your baby. It streams audio and video to the parent phone.',
  },
  {
    role: 'parent',
    title: 'Parent unit',
    body: 'Keep this phone with you. It watches and listens, and alerts you about crying or movement.',
  },
];

function RoleSelectScreen(_props: OnboardingScreenProps<'RoleSelect'>) {
  const theme = useTheme();
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
      <View style={styles.content}>
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
          What is this phone for?
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
          You can change this any time before pairing.
        </Text>

        {ROLE_OPTIONS.map(option => (
          <TouchableOpacity
            key={option.role}
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
            onPress={() => onSelect(option.role)}>
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
              {option.title}
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
              {option.body}
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
    paddingHorizontal: 24,
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
