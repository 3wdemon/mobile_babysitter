/**
 * MotionIndicator — minimal motion / stillness readout (DMY-25).
 *
 * Presentational only: it renders a live motion bar (metric vs. threshold) and a
 * status label that reflects whether the scene is moving or still. It does NOT
 * own a detector or a source — the parent passes in the already-computed
 * {@link MotionDetectionState}-like values, so this stays a pure, easily-testable
 * view. Real video/CV wiring (DMY-17/DMY-45) lives one level up.
 *
 * All colours/typography/spacing come from `useTheme`; no raw hex.
 */
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../hooks/useTheme';
import type { MotionMetric } from './motionTypes';

/** Motion scale the indicator renders against. */
const SCALE_MIN = 0;
const SCALE_MAX = 1;

export interface MotionIndicatorProps {
  /** Latest motion metric on a 0..1 scale, or `null` before the first sample. */
  readonly metric: MotionMetric | null;
  /** The enter-threshold for the marker. */
  readonly threshold: MotionMetric;
  /** Whether the detector currently considers the scene to be moving. */
  readonly moving: boolean;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

function MotionIndicator({ metric, threshold, moving }: MotionIndicatorProps) {
  const theme = useTheme();

  const fill = metric === null ? 0 : clamp01(metric);
  const markerLeft = clamp01(threshold);
  const barColor = moving ? theme.colors.warning : theme.colors.success;

  return (
    <View
      testID="motion-indicator"
      accessibilityRole="progressbar"
      accessibilityLabel="Motion level"
      style={[styles.container, { gap: theme.spacing.xs }]}
    >
      <Text
        style={[
          styles.label,
          {
            color: moving ? theme.colors.warning : theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.sm,
            fontWeight: theme.typography.fontWeights.semibold,
          },
        ]}
      >
        {moving ? 'Motion detected' : 'Still'}
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
          testID="motion-indicator-fill"
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
          testID="motion-indicator-threshold"
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

export default MotionIndicator;
