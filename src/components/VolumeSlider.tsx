/**
 * VolumeSlider — parent-unit playback volume control (DMY-56).
 *
 * Lets the parent set the monitor's OUTPUT volume on a 0..1 scale. The value is
 * persisted in the store (`settings.playbackVolume`) AND applied live to the
 * {@link AudioPlayback} controller via `setVolume`, so moving the control both
 * changes the audible level and survives an app restart.
 *
 * ## Control choice (no native slider dependency)
 * The project deliberately has NO slider dependency: SettingsScreen renders its
 * 0..1 scalars as segmented steppers rather than pull in
 * `@react-native-community/slider` and its native linking for a small scalar
 * (see SettingsScreen docs). We stay consistent for this 2-pt task and build a
 * lightweight, fully-accessible STEPPED slider: a −/+ pair around a filled track
 * of discrete steps. The whole control is a single `adjustable` element with
 * `accessibilityValue` (a percentage) and increment/decrement actions, so
 * VoiceOver/TalkBack users can swipe to change volume exactly as they would a
 * native slider — without the native dependency or its overnight-reliability
 * surface. A PanResponder pixel-drag slider was considered but rejected: it adds
 * gesture/layout complexity and is HARDER to make accessible than this stepped
 * control, for no real UX gain at this granularity.
 *
 * ## Mute (volume 0) is not disconnect
 * Stepping to `0` sets the output volume to silence via `setVolume(0)`. It does
 * NOT call `stop()` — the remote stream stays attached and the P2P link stays
 * connected, so detection/alerts keep running and the user can raise the volume
 * again instantly. This boundary lives in `AudioPlayback.setVolume`.
 *
 * Theme-tokenised (dark/night palette by default, matching the in-session parent
 * controls) and i18n-driven (`volume.*`). No hard-coded strings or hex values.
 */
import { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import type { ThemeMode } from '../theme';

/**
 * Number of discrete steps the stepped slider snaps to, INCLUDING the 0 (mute)
 * end. With 5 steps the values are 0, 0.25, 0.5, 0.75, 1 — coarse enough to hit
 * by swipe/tap, fine enough to feel like a volume control.
 */
export const VOLUME_STEPS = 5;

/** Step size between adjacent levels (1 / (steps - 1)). */
const STEP = 1 / (VOLUME_STEPS - 1);

/** Clamp onto [0,1] and snap to the nearest discrete step. */
function snapToStep(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, volume));
  return Math.round(clamped / STEP) * STEP;
}

/** Render a 0..1 volume as an integer percentage for the a11y value/label. */
function toPercent(volume: number): number {
  return Math.round(Math.min(1, Math.max(0, volume)) * 100);
}

export interface VolumeSliderProps {
  /** Current volume on a 0..1 scale (typically `settings.playbackVolume`). */
  readonly volume: number;
  /**
   * Called with the next 0..1 volume when the user changes it. Already clamped
   * and snapped to a step. The caller persists it (`setPlaybackVolume`) AND
   * applies it to the controller (`setVolume`).
   */
  readonly onChange: (volume: number) => void;
  /** Theme selection passed through to `useTheme`. Defaults to night palette. */
  readonly mode?: ThemeMode;
}

function VolumeSlider({ volume, onChange, mode = 'dark' }: VolumeSliderProps) {
  const theme = useTheme(mode);
  const { t } = useTranslation();

  const current = snapToStep(volume);
  const percent = toPercent(current);
  const muted = current <= 0;

  // Index of the active step (0..VOLUME_STEPS-1) for rendering the filled track.
  const activeIndex = Math.round(current / STEP);

  const emit = useCallback(
    (next: number) => {
      const snapped = snapToStep(next);
      // Only emit on a real change so we don't spam setVolume on a no-op tap.
      if (snapped !== current) {
        onChange(snapped);
      }
    },
    [current, onChange],
  );

  const decrement = useCallback(() => emit(current - STEP), [current, emit]);
  const increment = useCallback(() => emit(current + STEP), [current, emit]);

  const onAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === 'increment') {
        increment();
      } else if (event.nativeEvent.actionName === 'decrement') {
        decrement();
      }
    },
    [increment, decrement],
  );

  return (
    <View
      testID="volume-slider"
      // The whole control is one adjustable element so assistive tech treats it
      // like a native slider: swipe up/down maps to increment/decrement.
      accessibilityRole="adjustable"
      accessibilityLabel={t('volume.label')}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: percent,
        text: t('volume.valueA11y', { percent }),
      }}
      accessibilityActions={[
        { name: 'increment' },
        { name: 'decrement' },
      ]}
      onAccessibilityAction={onAccessibilityAction}
      style={styles.root}
    >
      <Text
        testID="volume-label"
        style={[
          styles.label,
          {
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.xs,
            fontWeight: theme.typography.fontWeights.semibold,
            marginBottom: theme.spacing.xs,
          },
        ]}
      >
        {t('volume.label')}
      </Text>

      <View style={styles.row}>
        <TouchableOpacity
          testID="volume-decrement"
          accessibilityRole="button"
          accessibilityLabel={t('volume.decrementA11y')}
          disabled={muted}
          activeOpacity={0.85}
          onPress={decrement}
          style={[
            styles.stepButton,
            muted ? styles.stepButtonDisabled : null,
            {
              borderColor: theme.colors.border,
              borderRadius: theme.spacing.sm,
              paddingVertical: theme.spacing.xs,
              paddingHorizontal: theme.spacing.sm,
              marginRight: theme.spacing.sm,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          <Text
            style={[
              styles.stepText,
              {
                color: theme.colors.text,
                fontSize: theme.typography.fontSizes.md,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}
          >
            {'−'}
          </Text>
        </TouchableOpacity>

        <View testID="volume-track" style={styles.track}>
          {Array.from({ length: VOLUME_STEPS }).map((_, index) => {
            const filled = index <= activeIndex && !muted;
            return (
              <View
                // Static index keys: the step set is a fixed-length scale.
                key={`step-${index}`}
                testID={`volume-step-${index}`}
                style={[
                  styles.step,
                  {
                    borderRadius: theme.spacing.xs,
                    marginHorizontal: theme.spacing.xs / 2,
                    backgroundColor: filled
                      ? theme.colors.primary
                      : theme.colors.border,
                  },
                ]}
              />
            );
          })}
        </View>

        <TouchableOpacity
          testID="volume-increment"
          accessibilityRole="button"
          accessibilityLabel={t('volume.incrementA11y')}
          disabled={current >= 1}
          activeOpacity={0.85}
          onPress={increment}
          style={[
            styles.stepButton,
            current >= 1 ? styles.stepButtonDisabled : null,
            {
              borderColor: theme.colors.border,
              borderRadius: theme.spacing.sm,
              paddingVertical: theme.spacing.xs,
              paddingHorizontal: theme.spacing.sm,
              marginLeft: theme.spacing.sm,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          <Text
            style={[
              styles.stepText,
              {
                color: theme.colors.text,
                fontSize: theme.typography.fontSizes.md,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}
          >
            {'+'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text
        testID="volume-value"
        style={[
          styles.value,
          {
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.xs,
            lineHeight: theme.typography.lineHeights.xs,
            marginTop: theme.spacing.xs,
          },
        ]}
      >
        {muted
          ? t('volume.muted')
          : t('volume.value', { percent })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'flex-start',
  },
  label: {
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  stepButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 40,
  },
  stepButtonDisabled: {
    opacity: 0.4,
  },
  stepText: {
    textAlign: 'center',
  },
  track: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  step: {
    flex: 1,
    height: 8,
  },
  value: {
    textAlign: 'left',
  },
});

export default VolumeSlider;
