/**
 * LoadingState — unified async-loading placeholder (DMY-59).
 *
 * A centered spinner with an optional message, used by any screen while it is
 * waiting on asynchronous work (scanning the LAN for baby-units, the parent
 * connecting to a paired unit, etc.). It exists so every screen shows the SAME
 * loading affordance instead of ad-hoc per-screen text.
 *
 * All colours/typography/spacing come from design tokens via `useTheme`; no raw
 * hex values are hard-coded. The view is announced to screen readers
 * (`accessibilityRole="progressbar"`, with a sensible default label) so a
 * blind user knows the screen is busy rather than empty.
 */
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';

export interface LoadingStateProps {
  /**
   * Optional message shown beneath the spinner (e.g. "Looking for baby
   * units…"). Omit for a bare spinner.
   */
  readonly message?: string;
  /**
   * Accessibility label announced for the busy state. Defaults to `message`
   * when given, otherwise a generic "Loading". Pass this when there is no
   * visible message but you still want a meaningful announcement.
   */
  readonly accessibilityLabel?: string;
  /** testID for integration tests. Defaults to `loading-state`. */
  readonly testID?: string;
}

function LoadingState({
  message,
  accessibilityLabel,
  testID = 'loading-state',
}: LoadingStateProps) {
  const theme = useTheme();

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? message ?? 'Loading'}
      style={[styles.container, { padding: theme.spacing.xl }]}
    >
      <ActivityIndicator
        testID={`${testID}-spinner`}
        color={theme.colors.primary}
        size="large"
      />
      {message ? (
        <Text
          style={[
            styles.message,
            {
              color: theme.colors.textMuted,
              fontSize: theme.typography.fontSizes.md,
              lineHeight: theme.typography.lineHeights.md,
              marginTop: theme.spacing.md,
            },
          ]}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    textAlign: 'center',
    maxWidth: 320,
  },
});

export default LoadingState;
