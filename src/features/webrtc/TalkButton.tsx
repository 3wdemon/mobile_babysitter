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
 * bedroom): `useTheme('dark')`. All colours/typography/spacing come from tokens,
 * and all copy/labels come from the i18n catalog (`webrtc.talk.*`).
 *
 * Accessibility (DMY-65): the control is a `button` with an explicit, honest
 * `accessibilityLabel` (its visible "Talking…/Hold to talk" caption is just a
 * short glyph-like word, so the screen reader gets a descriptive label instead
 * of the raw caption). `accessibilityState` carries the disabled/busy state. The
 * decorative status dot is hidden from assistive tech so the indicator reads as
 * a single, meaningful line. Text scales with the OS font size (we never set
 * `allowFontScaling={false}`) and the visible label is capped at
 * `maxFontSizeMultiplier` so the fixed button does not overflow at extreme sizes.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';

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
  const { t } = useTranslation();

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
          talking
            ? t('webrtc.talk.buttonA11yTalking')
            : t('webrtc.talk.buttonA11yIdle')
        }
        accessibilityHint={
          disabled
            ? t('webrtc.talk.hintUnavailable')
            : t('webrtc.talk.hintReady')
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
          // The caption is decorative for assistive tech: the TouchableOpacity
          // already exposes a full descriptive accessibilityLabel above.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          maxFontSizeMultiplier={theme.typography.maxFontSizeMultiplier}
          style={[
            styles.label,
            {
              color: labelColor,
              fontSize: theme.typography.fontSizes.md,
              fontWeight: theme.typography.fontWeights.bold,
            },
          ]}
        >
          {talking
            ? t('webrtc.talk.talkingLabel')
            : t('webrtc.talk.idleLabel')}
        </Text>
      </TouchableOpacity>

      {talking ? (
        <View
          testID="talk-indicator"
          accessibilityRole="text"
          accessibilityLabel={t('webrtc.talk.indicatorA11y')}
          style={[styles.indicatorRow, { gap: theme.spacing.sm }]}
        >
          <View
            // Decorative status dot — hide from assistive tech so the row reads
            // as one meaningful line via the label above.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.dot, { backgroundColor: theme.colors.danger }]}
          />
          <Text
            // Visible duplicate of the row's label — hidden from assistive
            // tech to avoid a double announcement.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
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
            {t('webrtc.talk.indicatorText')}
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
            ? t('webrtc.talk.hintUnavailable')
            : t('webrtc.talk.hintReady')}
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
