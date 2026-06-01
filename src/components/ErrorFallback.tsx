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
      style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text
        style={[
          styles.title,
          {
            color: theme.colors.text,
            fontSize: theme.typography.fontSizes.lg,
            fontWeight: theme.typography.fontWeights.semibold,
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
          },
        ]}>
        The app ran into an unexpected problem. You can try again — your
        connection settings are kept on this device.
      </Text>

      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.button, { backgroundColor: theme.colors.primary }]}
        onPress={onReset}>
        <Text style={[styles.buttonLabel, { color: theme.colors.onPrimary }]}>
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
    padding: 24,
  },
  title: {
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    marginBottom: 24,
    textAlign: 'center',
    maxWidth: 320,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    minWidth: 220,
    alignItems: 'center',
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ErrorFallback;
