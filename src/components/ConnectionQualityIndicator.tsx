/**
 * ConnectionQualityIndicator — 4-level link-quality chip for the parent-unit
 * (DMY-53).
 *
 * Renders a compact signal-bars + label indicator for the current connection
 * quality (`excellent | good | fair | poor`). It is purely presentational: the
 * level is resolved by {@link useConnectionQuality} and passed in via
 * `getStats` (optional — see DMY-45). Bars fill from 1 (poor) to 4 (excellent)
 * and are coloured from the semantic theme tokens (success/primary/warning/
 * danger). On the lowest level a quiet, non-blocking warning line appears below
 * the chip.
 *
 * Accessibility: the chip is an `image` with an `accessibilityLabel` that
 * announces the level via the i18n `connectionQuality.a11y` string; on the poor
 * level the warning is an `alert` live region (announced once, politely) so it
 * is surfaced without stealing focus from monitoring.
 *
 * All colours/typography/spacing come from `useTheme`; all copy from the i18n
 * catalog (`connectionQuality.*`). No hard-coded strings or hex values.
 */
import { StyleSheet, Text, View } from 'react-native';

import {
  QUALITY_LEVEL_ORDER,
  isWarningLevel,
  type ConnectionQuality,
} from '../features/webrtc/connectionQuality';
import {
  useConnectionQuality,
  type UseConnectionQualityOptions,
} from '../features/webrtc/useConnectionQuality';
import type { GetConnectionStats } from '../features/webrtc/connectionQuality';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import type { Theme, ThemeMode } from '../theme';

/** How many bars are filled per level (best -> all four). */
const FILLED_BARS: Record<ConnectionQuality, number> = {
  excellent: 4,
  good: 3,
  fair: 2,
  poor: 1,
};

/** Width of a single signal bar (px). */
const BAR_WIDTH = 4;
/** Horizontal gap between adjacent bars (px). */
const BAR_GAP = 2;
/** Corner radius of a bar (px). */
const BAR_RADIUS = 1;
/** Corner radius of the chip container (px). */
const CHIP_RADIUS = 8;
/** Gap between the bars and the level label (px). */
const LABEL_GAP = 6;

export interface ConnectionQualityIndicatorProps {
  /**
   * Optional stats provider (RTT/loss). Absent until DMY-45 wires the media
   * pipeline; the indicator then degrades to the status-derived level.
   */
  readonly getStats?: GetConnectionStats;
  /** Poll cadence forwarded to {@link useConnectionQuality}. */
  readonly options?: UseConnectionQualityOptions;
  /** Theme selection passed through to `useTheme`. */
  readonly mode?: ThemeMode;
}

/** Semantic colour for a level, from the theme tokens. */
function colorForLevel(level: ConnectionQuality, theme: Theme): string {
  switch (level) {
    case 'excellent':
      return theme.colors.success;
    case 'good':
      return theme.colors.primary;
    case 'fair':
      return theme.colors.warning;
    case 'poor':
    default:
      return theme.colors.danger;
  }
}

function ConnectionQualityIndicator({
  getStats,
  options,
  mode = 'system',
}: ConnectionQualityIndicatorProps) {
  const theme = useTheme(mode);
  const { t } = useTranslation();
  const level = useConnectionQuality(getStats, options);

  const levelLabel = t(`connectionQuality.levels.${level}`);
  const a11yLabel = t('connectionQuality.a11y', { level: levelLabel });
  const accentColor = colorForLevel(level, theme);
  const filled = FILLED_BARS[level];
  const showWarning = isWarningLevel(level);

  return (
    <View testID="connection-quality" style={styles.root}>
      <View
        testID="connection-quality-chip"
        accessibilityRole="image"
        accessibilityLabel={a11yLabel}
        style={[
          styles.chip,
          {
            backgroundColor: theme.colors.surface,
            paddingVertical: theme.spacing.xs,
            paddingHorizontal: theme.spacing.sm,
          },
        ]}
      >
        <View
          testID="connection-quality-bars"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.bars}
        >
          {QUALITY_LEVEL_ORDER.map((_, index) => {
            // Bars render shortest (index 0) -> tallest, filling left-to-right.
            const barNumber = index + 1;
            const isFilled = barNumber <= filled;
            return (
              <View
                key={barNumber}
                testID={`connection-quality-bar-${barNumber}`}
                style={[
                  styles.bar,
                  {
                    height: theme.spacing.sm + index * theme.spacing.xs,
                    backgroundColor: isFilled
                      ? accentColor
                      : theme.colors.border,
                  },
                ]}
              />
            );
          })}
        </View>
        <Text
          testID="connection-quality-label"
          style={[
            styles.label,
            {
              color: theme.colors.text,
              fontSize: theme.typography.fontSizes.sm,
              fontWeight: theme.typography.fontWeights.semibold,
            },
          ]}
        >
          {levelLabel}
        </Text>
      </View>

      {showWarning ? (
        <Text
          testID="connection-quality-warning"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{
            color: theme.colors.danger,
            fontSize: theme.typography.fontSizes.xs,
            marginTop: theme.spacing.xs,
          }}
        >
          {t('connectionQuality.warning')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'flex-start',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: CHIP_RADIUS,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  bar: {
    width: BAR_WIDTH,
    marginRight: BAR_GAP,
    borderRadius: BAR_RADIUS,
  },
  label: {
    marginLeft: LABEL_GAP,
  },
});

export default ConnectionQualityIndicator;
