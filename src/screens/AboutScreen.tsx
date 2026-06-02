/**
 * AboutScreen — app identity surface (DMY-64).
 *
 * Shows the app name, version, and a link to the Privacy Policy. Renders ONLY
 * static app info (see ../constants/appInfo) — no user data is read or shown.
 *
 * Reachable today via the registered route in RootNavigator; the intended
 * entry point (Settings) is wired in by DMY-52.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { APP_NAME, APP_VERSION } from '../constants/appInfo';
import { useTheme } from '../hooks/useTheme';
import type { RootStackScreenProps } from '../navigation/types';

function AboutScreen({ navigation }: RootStackScreenProps<'About'>) {
  const theme = useTheme();

  return (
    <View
      testID="about-screen"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.background,
          padding: theme.spacing.xl,
        },
      ]}>
      <Text
        testID="about-app-name"
        accessibilityRole="header"
        style={[
          styles.appName,
          {
            color: theme.colors.text,
            fontSize: theme.typography.fontSizes.xxl,
            fontWeight: theme.typography.fontWeights.bold,
          },
        ]}>
        {APP_NAME}
      </Text>

      <Text
        testID="about-version"
        accessibilityLabel={`Version ${APP_VERSION}`}
        style={[
          styles.version,
          {
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.md,
            marginTop: theme.spacing.xs,
          },
        ]}>
        {`Version ${APP_VERSION}`}
      </Text>

      <Text
        style={[
          styles.tagline,
          {
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.sm,
            lineHeight: theme.typography.lineHeights.sm,
            marginTop: theme.spacing.md,
          },
        ]}>
        Privacy-first baby monitor. Peer-to-peer, no cloud, no account.
      </Text>

      <TouchableOpacity
        testID="about-privacy-link"
        accessibilityRole="link"
        accessibilityLabel="Open the privacy policy"
        style={[
          styles.privacyLink,
          {
            borderColor: theme.colors.border,
            borderRadius: theme.spacing.sm,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            marginTop: theme.spacing.xl,
          },
        ]}
        onPress={() => navigation.navigate('PrivacyPolicy')}>
        <Text
          style={[
            styles.privacyLinkLabel,
            {
              color: theme.colors.primary,
              fontSize: theme.typography.fontSizes.md,
              fontWeight: theme.typography.fontWeights.semibold,
            },
          ]}>
          Privacy Policy
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: {
    textAlign: 'center',
  },
  version: {
    textAlign: 'center',
  },
  tagline: {
    textAlign: 'center',
  },
  privacyLink: {
    borderWidth: 1,
    alignItems: 'center',
  },
  privacyLinkLabel: {},
});

export default AboutScreen;
