/**
 * PowerSaverIndicator — baby-unit power-saver status + toggle (DMY-12).
 *
 * Shows whether the low-power night posture is active and lets the user opt the
 * feature on/off. Intentionally rendered against the DARK / AOD palette: this is
 * the dim, night-time face of the baby-unit, so we resolve `useTheme('dark')`
 * explicitly rather than following the OS scheme — the nursery screen should be
 * near-black regardless of system setting.
 *
 * Presentational + a single store toggle; the actual device effects live in the
 * service/hook. All colours/typography/spacing come from tokens; no raw hex.
 */
import { StyleSheet, Switch, Text, View } from 'react-native';

import { useTheme } from '../../hooks/useTheme';
import { useAppStore } from '../../store/useAppStore';

export interface PowerSaverIndicatorProps {
  /** Whether the low-power posture is currently applied (from usePowerSaver). */
  readonly active: boolean;
}

function PowerSaverIndicator({ active }: PowerSaverIndicatorProps) {
  // Night/AOD palette: the baby-unit face is dark by design.
  const theme = useTheme('dark');
  const enabled = useAppStore(s => s.settings.powerSaverEnabled);
  const setPowerSaverEnabled = useAppStore(s => s.setPowerSaverEnabled);

  const statusLabel = !enabled
    ? 'Power-saver off'
    : active
    ? 'Power-saver on · screen dimmed'
    : 'Power-saver standby';

  return (
    <View
      testID="power-saver-indicator"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.spacing.md,
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
        },
      ]}
    >
      <View style={styles.row}>
        <Text
          style={[
            styles.label,
            {
              color: active ? theme.colors.success : theme.colors.textMuted,
              fontSize: theme.typography.fontSizes.sm,
              fontWeight: theme.typography.fontWeights.semibold,
            },
          ]}
        >
          {statusLabel}
        </Text>

        <Switch
          testID="power-saver-toggle"
          accessibilityRole="switch"
          accessibilityLabel="Power-saver mode"
          value={enabled}
          onValueChange={setPowerSaverEnabled}
          trackColor={{
            false: theme.colors.border,
            true: theme.colors.primary,
          }}
          thumbColor={theme.colors.onPrimary}
        />
      </View>

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
        Dims the screen and disables unused sensors during monitoring to save
        battery. The display stays on so the session keeps running.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    flexShrink: 1,
  },
  hint: {},
});

export default PowerSaverIndicator;
