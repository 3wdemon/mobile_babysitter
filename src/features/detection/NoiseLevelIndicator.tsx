/**
 * NoiseLevelIndicator — minimal baby-unit readout for noise detection (DMY-8).
 *
 * Presentational only: it renders a live loudness bar (level vs. threshold) and
 * an armed badge. It does NOT own a detector or a source — the parent passes in
 * the already-computed {@link NoiseDetectionState}-like values, so this stays a
 * pure, easily-testable view. Real audio wiring (DMY-18) lives one level up.
 *
 * All colours/typography/spacing come from `useTheme`; no raw hex.
 */
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../hooks/useTheme';
import type { NoiseLevel } from './types';

/** Loudness scale the indicator renders against. */
const SCALE_MIN = 0;
const SCALE_MAX = 1;

export interface NoiseLevelIndicatorProps {
  /** Latest loudness level on a 0..1 scale, or `null` before the first sample. */
  readonly level: NoiseLevel | null;
  /** The enter-threshold for the marker. */
  readonly threshold: NoiseLevel;
  /** Whether the detector is currently in the loud band. */
  readonly armed: boolean;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

function NoiseLevelIndicator({
  level,
  threshold,
  armed,
}: NoiseLevelIndicatorProps) {
  const theme = useTheme();

  const fill = level === null ? 0 : clamp01(level);
  const markerLeft = clamp01(threshold);
  const barColor = armed ? theme.colors.danger : theme.colors.success;

  return (
    <View
      testID="noise-indicator"
      accessibilityRole="progressbar"
      accessibilityLabel="Noise level"
      style={[styles.container, { gap: theme.spacing.xs }]}
    >
      <Text
        style={[
          styles.label,
          {
            color: armed ? theme.colors.danger : theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.sm,
            fontWeight: theme.typography.fontWeights.semibold,
          },
        ]}
      >
        {armed ? 'Noise detected' : 'Listening'}
      </Text>

      <View
        style={[
          styles.track,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.spacing.xs,
          },
        ]}
      >
        <View
          testID="noise-indicator-fill"
          style={[
            styles.fill,
            {
              width: `${fill * 100}%`,
              backgroundColor: barColor,
              borderRadius: theme.spacing.xs,
            },
          ]}
        />
        <View
          testID="noise-indicator-threshold"
          style={[
            styles.threshold,
            {
              left: `${markerLeft * 100}%`,
              backgroundColor: theme.colors.text,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {},
  track: {
    width: '100%',
    height: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fill: {
    height: '100%',
  },
  threshold: {
    position: 'absolute',
    width: 2,
    height: '100%',
  },
});

export default NoiseLevelIndicator;
