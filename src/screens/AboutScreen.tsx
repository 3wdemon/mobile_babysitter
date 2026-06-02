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
import { useTranslation } from '../hooks/useTranslation';
import type { RootStackScreenProps } from '../navigation/types';

function AboutScreen({ navigation }: RootStackScreenProps<'About'>) {
  const theme = useTheme();
  const { t } = useTranslation();

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
        accessibilityLabel={t('about.versionA11y', { version: APP_VERSION })}
        style={[
          styles.version,
          {
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.md,
            marginTop: theme.spacing.xs,
          },
        ]}>
        {t('about.version', { version: APP_VERSION })}
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
        {t('about.tagline')}
      </Text>

      <TouchableOpacity
        testID="about-privacy-link"
        accessibilityRole="link"
        accessibilityLabel={t('about.privacyLinkA11y')}
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
          {t('about.privacyLink')}
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
