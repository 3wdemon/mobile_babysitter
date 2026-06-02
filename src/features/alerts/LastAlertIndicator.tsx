/**
 * LastAlertIndicator — minimal parent-unit readout of the most recent alert
 * (DMY-26).
 *
 * Presentational only: given the latest {@link AlertEvent} (or `null`), it shows
 * the alert TYPE and when it fired. It owns no service/source — the parent
 * screen passes the already-computed value from {@link useAlerts}, keeping this a
 * pure, easily-testable view.
 *
 * Privacy: renders only the alert type and a relative time — never a metric,
 * frame or any media (the {@link AlertEvent} carries none). All colours /
 * typography / spacing come from `useTheme`; no raw hex.
 */
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../hooks/useTheme';
import type { AlertEvent, AlertType } from './alertTypes';

/** Human-readable label per alert type. */
const LABEL_BY_TYPE: Record<AlertType, string> = {
  cry: 'Crying',
  motion: 'Movement',
  noise: 'Noise',
  no_motion: 'No movement',
};

export interface LastAlertIndicatorProps {
  /** The most recent alert, or `null` when none has fired this session. */
  readonly alert: AlertEvent | null;
}

function LastAlertIndicator({ alert }: LastAlertIndicatorProps) {
  const theme = useTheme();

  const label = alert ? LABEL_BY_TYPE[alert.type] : 'No alerts yet';
  const active = alert !== null;

  return (
    <View
      testID="last-alert-indicator"
      accessibilityRole="text"
      accessibilityLabel={
        active ? `Last alert: ${label}` : 'No alerts yet'
      }
      style={[
        styles.container,
        {
          gap: theme.spacing.xs,
          backgroundColor: theme.colors.surface,
          borderColor: active ? theme.colors.danger : theme.colors.border,
          borderRadius: theme.spacing.xs,
          padding: theme.spacing.sm,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          {
            color: active ? theme.colors.danger : theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.sm,
            fontWeight: theme.typography.fontWeights.semibold,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {},
});

export default LastAlertIndicator;
