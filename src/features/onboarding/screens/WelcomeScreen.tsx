/**
 * WelcomeScreen — first onboarding step (DMY-42).
 *
 * Leads with the product's core promise: a local, peer-to-peer baby monitor
 * with no cloud dependency and end-to-end encryption (see product-spec, pain
 * point #8). All copy is privacy-first by design; `Continue` advances to the
 * permissions step. Colours/typography come exclusively from design tokens via
 * `useTheme` — no hard-coded values.
 */
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../../../hooks/useTheme';
import { useTranslation } from '../../../hooks/useTranslation';
import type { OnboardingScreenProps } from '../types';

/**
 * Privacy-first selling points shown on the welcome step. Each entry is a
 * stable catalog key under `onboarding.welcome.highlights.*` (DMY-63); the copy
 * itself lives in the locale catalogs.
 */
const HIGHLIGHT_KEYS = ['p2p', 'noCloud', 'e2e'] as const;

function WelcomeScreen({ navigation }: OnboardingScreenProps<'Welcome'>) {
  const theme = useTheme();
  const { t } = useTranslation();

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
              fontSize: theme.typography.fontSizes.xxl,
              fontWeight: theme.typography.fontWeights.bold,
              lineHeight: theme.typography.lineHeights.xxl,
              marginBottom: theme.spacing.sm,
            },
          ]}>
          {t('onboarding.welcome.title')}
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
          {t('onboarding.welcome.subtitle')}
        </Text>

        {HIGHLIGHT_KEYS.map(key => (
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
              {t(`onboarding.welcome.highlights.${key}.title`)}
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
              {t(`onboarding.welcome.highlights.${key}.body`)}
            </Text>
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
          onPress={() => navigation.navigate('Permissions')}>
          <Text
            style={[
              styles.buttonLabel,
              {
                color: theme.colors.onPrimary,
                fontSize: theme.typography.fontSizes.md,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}>
            {t('onboarding.welcome.continue')}
          </Text>
        </TouchableOpacity>
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
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    alignItems: 'center',
  },
  buttonLabel: {},
});

export default WelcomeScreen;
