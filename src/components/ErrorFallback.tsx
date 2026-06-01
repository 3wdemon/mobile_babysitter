/**
 * ErrorFallback — neutral UI shown when the top-level ErrorBoundary catches a
 * render/lifecycle crash.
 *
 * Privacy-first: the message is intentionally generic and never surfaces the
 * underlying error text or component stack to the user (those go only to the
 * redacting logger). Styling uses design tokens via `useTheme` so the fallback
 * respects the active light/dark palette.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';

export interface ErrorFallbackProps {
  /** Resets the boundary and remounts the previously-crashed subtree. */
  onReset: () => void;
}

function ErrorFallback({ onReset }: ErrorFallbackProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.background,
          padding: theme.spacing.xl,
        },
      ]}>
      <Text
        style={[
          styles.title,
          {
            color: theme.colors.text,
            fontSize: theme.typography.fontSizes.lg,
            fontWeight: theme.typography.fontWeights.semibold,
            marginBottom: theme.spacing.md,
          },
        ]}>
        Something went wrong
      </Text>

      <Text
        style={[
          styles.message,
          {
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.md,
            marginBottom: theme.spacing.xl,
          },
        ]}>
        The app ran into an unexpected problem. You can try again — your
        connection settings are kept on this device.
      </Text>

      <TouchableOpacity
        accessibilityRole="button"
        style={[
          styles.button,
          {
            backgroundColor: theme.colors.primary,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.xl,
          },
        ]}
        onPress={onReset}>
        <Text
          style={{
            color: theme.colors.onPrimary,
            fontSize: theme.typography.fontSizes.md,
            fontWeight: theme.typography.fontWeights.semibold,
          }}>
          Try again
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
  title: {
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    maxWidth: 320,
  },
  button: {
    borderRadius: 8,
    minWidth: 220,
    alignItems: 'center',
  },
});

export default ErrorFallback;
