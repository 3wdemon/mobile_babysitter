/**
 * EmptyState — unified "nothing here yet" placeholder (DMY-59).
 *
 * Shown when an async screen has finished loading but has no data to display
 * (e.g. a LAN scan that completed with zero baby-units found). It pairs a clear
 * title with guidance copy so the empty result never looks like a bug, plus an
 * OPTIONAL primary action (e.g. "Scan again"). It exists so every screen uses
 * the SAME empty affordance rather than ad-hoc per-screen text.
 *
 * An optional leading glyph (`icon`, a short emoji/character) gives the state a
 * visual anchor; it is decorative and hidden from screen readers so the title +
 * description carry the meaning. All colours/typography/spacing come from design
 * tokens via `useTheme`; no raw hex values. The container is announced as
 * `accessibilityRole="summary"` with the title as its label.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';

export interface EmptyStateProps {
  /** Short headline (e.g. "No baby units found"). */
  readonly title: string;
  /** Guidance copy explaining what to do next. */
  readonly description?: string;
  /** Optional decorative leading glyph (emoji/character). */
  readonly icon?: string;
  /** Label for the optional primary action button. */
  readonly actionLabel?: string;
  /** Called when the action button is pressed. Required to render the button. */
  readonly onAction?: () => void;
  /** testID for integration tests. Defaults to `empty-state`. */
  readonly testID?: string;
}

function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  testID = 'empty-state',
}: EmptyStateProps) {
  const theme = useTheme();
  const showAction = !!actionLabel && !!onAction;

  return (
    <View
      testID={testID}
      accessibilityRole="summary"
      accessibilityLabel={title}
      style={[styles.container, { padding: theme.spacing.xl }]}
    >
      {icon ? (
        <Text
          testID={`${testID}-icon`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.icon,
            {
              fontSize: theme.typography.fontSizes.xxl,
              marginBottom: theme.spacing.md,
            },
          ]}
        >
          {icon}
        </Text>
      ) : null}

      <Text
        accessibilityRole="header"
        style={[
          styles.title,
          {
            color: theme.colors.text,
            fontSize: theme.typography.fontSizes.lg,
            fontWeight: theme.typography.fontWeights.semibold,
            lineHeight: theme.typography.lineHeights.lg,
          },
        ]}
      >
        {title}
      </Text>

      {description ? (
        <Text
          style={[
            styles.description,
            {
              color: theme.colors.textMuted,
              fontSize: theme.typography.fontSizes.md,
              lineHeight: theme.typography.lineHeights.md,
              marginTop: theme.spacing.sm,
            },
          ]}
        >
          {description}
        </Text>
      ) : null}

      {showAction ? (
        <TouchableOpacity
          accessibilityRole="button"
          testID={`${testID}-action`}
          onPress={onAction}
          style={[
            styles.action,
            {
              backgroundColor: theme.colors.primary,
              borderRadius: theme.spacing.sm,
              paddingVertical: theme.spacing.md,
              paddingHorizontal: theme.spacing.xl,
              marginTop: theme.spacing.xl,
            },
          ]}
        >
          <Text
            style={[
              styles.actionLabel,
              {
                color: theme.colors.onPrimary,
                fontSize: theme.typography.fontSizes.md,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}
          >
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    textAlign: 'center',
  },
  title: {
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    maxWidth: 320,
  },
  action: {
    alignItems: 'center',
    minWidth: 220,
  },
  actionLabel: {},
});

export default EmptyState;
