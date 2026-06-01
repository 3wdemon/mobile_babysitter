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
import type { OnboardingScreenProps } from '../types';

/** Privacy-first selling points shown on the welcome step. */
const HIGHLIGHTS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Local peer-to-peer',
    body: 'Your two phones talk directly over your home WiFi — works even without internet.',
  },
  {
    title: 'No cloud, no accounts',
    body: 'Audio and video never touch a server. There is nothing to hack and nothing to leak.',
  },
  {
    title: 'End-to-end encrypted',
    body: 'Every stream is encrypted between your devices, so only you can ever see or hear it.',
  },
];

function WelcomeScreen({ navigation }: OnboardingScreenProps<'Welcome'>) {
  const theme = useTheme();

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text
          accessibilityRole="header"
          style={[
            styles.title,
            {
              color: theme.colors.text,
              fontSize: theme.typography.fontSizes.xxl,
              fontWeight: theme.typography.fontWeights.bold,
              lineHeight: theme.typography.lineHeights.xxl,
            },
          ]}>
          Mobile Babysitter
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
          A premium baby monitor that runs entirely on your phones — private by
          design.
        </Text>

        {HIGHLIGHTS.map(item => (
          <View
            key={item.title}
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
              {item.title}
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
              {item.body}
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
            Continue
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
  content: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
  },
  title: {
    marginBottom: 8,
  },
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
