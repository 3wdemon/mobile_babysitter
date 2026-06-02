/**
 * PrivacyPolicyScreen — privacy positioning surface (DMY-64).
 *
 * IMPORTANT: the copy here is PLACEHOLDER. It states the product's privacy
 * posture (peer-to-peer, no cloud, no account) so the screen can be wired up
 * and reviewed, but it is NOT the final legal text. Final, lawyer-reviewed
 * policy copy lands in a later issue. The screen renders ONLY static product
 * positioning — it never reads, collects, or displays any user data.
 *
 * Reachable today via the registered route in RootNavigator; the intended
 * entry point (Settings) is wired in by DMY-52.
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';

/** Placeholder privacy bullets. Final legal text TBD (DMY-64 follow-up). */
const PRIVACY_POINTS: ReadonlyArray<{ key: string; text: string }> = [
  {
    key: 'p2p',
    text: 'Peer-to-peer: video and audio stream directly between your two phones.',
  },
  {
    key: 'no-cloud',
    text: 'No cloud: your stream is never uploaded to or stored on our servers.',
  },
  {
    key: 'no-account',
    text: 'No account: there is no sign-up, no login, and no email required.',
  },
];

function PrivacyPolicyScreen() {
  const theme = useTheme();

  return (
    <ScrollView
      testID="privacy-policy-screen"
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { padding: theme.spacing.xl }]}>
      {/* Placeholder banner — must be unmistakable that this is not final copy. */}
      <View
        testID="placeholder-banner"
        accessibilityRole="alert"
        accessibilityLabel="This privacy policy is a placeholder. Final legal text is coming soon."
        style={[
          styles.banner,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.warning,
            borderRadius: theme.spacing.sm,
            padding: theme.spacing.md,
          },
        ]}>
        <Text
          style={[
            styles.bannerText,
            {
              color: theme.colors.warning,
              fontSize: theme.typography.fontSizes.sm,
              fontWeight: theme.typography.fontWeights.semibold,
            },
          ]}>
          PLACEHOLDER — final legal text coming soon.
        </Text>
      </View>

      <Text
        accessibilityRole="header"
        style={[
          styles.title,
          {
            color: theme.colors.text,
            fontSize: theme.typography.fontSizes.xl,
            fontWeight: theme.typography.fontWeights.bold,
            marginTop: theme.spacing.lg,
          },
        ]}>
        Privacy Policy
      </Text>

      <Text
        style={[
          styles.intro,
          {
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.md,
            lineHeight: theme.typography.lineHeights.md,
            marginTop: theme.spacing.sm,
          },
        ]}>
        Mobile Babysitter is privacy-first by design. The points below summarise
        how the app works.
      </Text>

      <View style={{ marginTop: theme.spacing.lg }}>
        {PRIVACY_POINTS.map(point => (
          <View
            key={point.key}
            testID={`privacy-point-${point.key}`}
            style={[styles.point, { marginBottom: theme.spacing.md }]}>
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={[
                styles.bullet,
                {
                  color: theme.colors.primary,
                  fontSize: theme.typography.fontSizes.md,
                  lineHeight: theme.typography.lineHeights.md,
                  marginRight: theme.spacing.sm,
                },
              ]}>
              {'•'}
            </Text>
            <Text
              style={[
                styles.pointText,
                {
                  color: theme.colors.text,
                  fontSize: theme.typography.fontSizes.md,
                  lineHeight: theme.typography.lineHeights.md,
                },
              ]}>
              {point.text}
            </Text>
          </View>
        ))}
      </View>

      <Text
        style={[
          styles.footnote,
          {
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.xs,
            lineHeight: theme.typography.lineHeights.xs,
            marginTop: theme.spacing.lg,
          },
        ]}>
        This text is a placeholder and does not constitute the final, legally
        binding privacy policy.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  banner: {
    borderWidth: 1,
  },
  bannerText: {
    textAlign: 'center',
  },
  title: {},
  intro: {},
  point: {
    flexDirection: 'row',
  },
  bullet: {},
  pointText: {
    flex: 1,
  },
  footnote: {
    fontStyle: 'italic',
  },
});

export default PrivacyPolicyScreen;
