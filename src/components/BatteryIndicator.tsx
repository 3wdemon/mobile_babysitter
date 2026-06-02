/**
 * BatteryIndicator — baby-unit battery level + low-battery warning (DMY-54).
 *
 * The baby phone has to survive the night for the monitor to keep working, so
 * its battery is surfaced on the baby-unit face. The chip shows the charge `%`
 * and a charging glyph; below it, a low-battery warning appears (as an `alert`
 * live region) when the source reports `isLow` (a KNOWN level < 20% and not
 * charging — the rule lives in `computeIsLow`). When the level is UNKNOWN (noop
 * source under Jest / bare JS) the chip degrades to a quiet neutral state and
 * the warning never shows.
 *
 * Intentionally rendered against the DARK / AOD palette: this is the dim,
 * night-time face of the baby-unit, so we resolve `useTheme('dark')` by default
 * (matching PowerSaverIndicator) rather than following the OS scheme.
 *
 * All colours/typography/spacing come from `useTheme`; all copy from the i18n
 * catalog (`battery.*`). No hard-coded strings or hex values.
 */
import { StyleSheet, Text, View } from 'react-native';

import { useBatteryStatus } from '../hooks/useBatteryStatus';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import type { BatterySource } from '../features/powersaver/batteryStatus';
import type { ThemeMode } from '../theme';

export interface BatteryIndicatorProps {
  /** Theme selection passed through to `useTheme` (defaults to the dark face). */
  readonly mode?: ThemeMode;
  /** Optional explicit battery source (mainly for tests). */
  readonly source?: BatterySource;
}

/** Format a `[0,1]` fraction as a whole-percent string (e.g. `0.185 -> "19%"`). */
function formatPercent(level: number): string {
  return `${Math.round(level * 100)}%`;
}

function BatteryIndicator({ mode = 'dark', source }: BatteryIndicatorProps) {
  const theme = useTheme(mode);
  const { t } = useTranslation();
  const { level, isCharging, isLow } = useBatteryStatus(source);

  const isUnknown = level === null;
  const percentText = isUnknown ? t('battery.unknown') : formatPercent(level);

  // Charging glyph only when we positively know it is charging.
  const chargingGlyph = isCharging === true ? '⚡' : '';

  // The chip's accent: danger when low, muted when unknown, otherwise normal
  // text. (Charging at low % is suppressed by computeIsLow, so isLow already
  // accounts for the charger.)
  const chipColor = isLow
    ? theme.colors.danger
    : isUnknown
    ? theme.colors.textMuted
    : theme.colors.text;

  const a11yLabel = isUnknown
    ? t('battery.a11yUnknown')
    : t('battery.a11y', {
        percent: percentText,
        state:
          isCharging === true
            ? t('battery.charging')
            : t('battery.onBattery'),
      });

  return (
    <View testID="battery-indicator" style={styles.root}>
      <View
        testID="battery-chip"
        accessibilityRole="text"
        accessibilityLabel={a11yLabel}
        style={[
          styles.chip,
          {
            backgroundColor: theme.colors.surface,
            borderColor: isLow ? theme.colors.danger : theme.colors.border,
            borderRadius: theme.spacing.sm,
            paddingVertical: theme.spacing.xs,
            paddingHorizontal: theme.spacing.sm,
            gap: theme.spacing.xs,
          },
        ]}
      >
        <Text
          testID="battery-level"
          style={[
            styles.level,
            {
              color: chipColor,
              fontSize: theme.typography.fontSizes.sm,
              fontWeight: theme.typography.fontWeights.semibold,
            },
          ]}
        >
          {percentText}
        </Text>
        {chargingGlyph ? (
          <Text
            testID="battery-charging-glyph"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              color: theme.colors.success,
              fontSize: theme.typography.fontSizes.sm,
            }}
          >
            {chargingGlyph}
          </Text>
        ) : null}
      </View>

      {isLow ? (
        <Text
          testID="battery-warning"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{
            color: theme.colors.danger,
            fontSize: theme.typography.fontSizes.xs,
            marginTop: theme.spacing.xs,
          }}
        >
          {t('battery.lowWarning')}
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
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  level: {},
});

export default BatteryIndicator;
