/**
 * TalkButton — parent-unit push-to-talk control (DMY-20).
 *
 * A hold-to-talk button: pressing it down (`onPressIn`) opens the parent
 * microphone toward the baby-unit (`startTalking`); releasing it (`onPressOut`)
 * closes the mic again (`stopTalking`). This half-duplex, "open only while held"
 * model is the structural guard against acoustic feedback — combined with the
 * native echo cancellation requested on the talk capture, the baby-unit hears a
 * clean voice without howl-round.
 *
 * The button surfaces an honest TALKING indicator that reflects the REAL
 * outgoing-track state (`talking`, driven by the controller), never a fabricated
 * one. When talk is not ready (`disabled` — e.g. before the session is up) the
 * button is inert and visibly dimmed.
 *
 * Rendered against the DARK / night palette (the parent watches in a dark
 * bedroom): `useTheme('dark')`. All colours/typography/spacing come from tokens.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../../hooks/useTheme';

export interface TalkButtonProps {
  /** Whether the parent is currently talking (outgoing track enabled). */
  readonly talking: boolean;
  /** Begin transmitting — wire to the hook's `startTalking`. */
  readonly onStartTalking: () => void;
  /** Stop transmitting — wire to the hook's `stopTalking`. */
  readonly onStopTalking: () => void;
  /**
   * Disable the control (e.g. talkback not enabled, or the session/talk capture
   * is not ready yet). Defaults to `false`.
   */
  readonly disabled?: boolean;
}

function TalkButton({
  talking,
  onStartTalking,
  onStopTalking,
  disabled = false,
}: TalkButtonProps) {
  // Night palette: the parent watches in a dark room.
  const theme = useTheme('dark');

  const backgroundColor = disabled
    ? theme.colors.surface
    : talking
    ? theme.colors.danger
    : theme.colors.primary;
  const labelColor = disabled ? theme.colors.textMuted : theme.colors.onPrimary;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: talking }}
        accessibilityLabel={
          talking ? 'Talking — release to stop' : 'Hold to talk'
        }
        testID="talk-button"
        activeOpacity={0.85}
        disabled={disabled}
        // Push-to-talk: open the mic only while the button is held.
        onPressIn={onStartTalking}
        onPressOut={onStopTalking}
        style={[
          styles.button,
          {
            backgroundColor,
            borderColor: theme.colors.border,
            borderRadius: theme.spacing.md,
            paddingVertical: theme.spacing.lg,
            paddingHorizontal: theme.spacing.xl,
          },
        ]}
      >
        <Text
          style={[
            styles.label,
            {
              color: labelColor,
              fontSize: theme.typography.fontSizes.md,
              fontWeight: theme.typography.fontWeights.bold,
            },
          ]}
        >
          {talking ? 'Talking…' : 'Hold to talk'}
        </Text>
      </TouchableOpacity>

      {talking ? (
        <View
          testID="talk-indicator"
          accessibilityRole="text"
          accessibilityLabel="Talking to baby"
          style={[styles.indicatorRow, { gap: theme.spacing.sm }]}
        >
          <View
            style={[styles.dot, { backgroundColor: theme.colors.danger }]}
          />
          <Text
            style={[
              styles.indicatorLabel,
              {
                color: theme.colors.danger,
                fontSize: theme.typography.fontSizes.xs,
                lineHeight: theme.typography.lineHeights.xs,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}
          >
            Your voice is going to the baby unit
          </Text>
        </View>
      ) : (
        <Text
          style={[
            styles.hint,
            {
              color: theme.colors.textMuted,
              fontSize: theme.typography.fontSizes.xs,
              lineHeight: theme.typography.lineHeights.xs,
            },
          ]}
        >
          {disabled
            ? 'Talk is available once the connection is up.'
            : 'Hold the button to speak. Echo cancellation keeps it feedback-free.'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  button: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    textAlign: 'center',
  },
  indicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  indicatorLabel: {
    flexShrink: 1,
  },
  hint: {
    textAlign: 'center',
    marginTop: 8,
  },
});

export default TalkButton;
