/**
 * LastAlertIndicator — parent-unit readout of the most recent alert, and the
 * surface for the snooze gesture (DMY-26, DMY-28).
 *
 * Presentational only: given the latest {@link AlertEvent} (or `null`), it shows
 * the alert TYPE and, when snoozed, a "Snoozed until HH:MM" badge with the
 * remaining minutes. It owns no service/source — the parent screen passes the
 * already-computed values from {@link useAlerts} / {@link useSnooze}, keeping
 * this a pure, easily-testable view.
 *
 * SNOOZE GESTURE (DMY-28): when `onSnoozeGesture` is provided the whole banner
 * becomes a `Pressable` whose LONG-PRESS triggers the snooze (the parent screen
 * wires it to `useSnooze().snooze`, which also fires the haptic). A long-press
 * (not a tap) is chosen deliberately: it cannot be triggered by an accidental
 * brush in a dark nursery, and needs no extra native gesture library — RN's
 * built-in `Pressable` is enough, keeping the dependency footprint minimal.
 * With no `onSnoozeGesture`, it renders as a plain `View` (back-compat).
 *
 * Privacy: renders only the alert type, a relative label and a snooze clock
 * time — never a metric, frame or any media (the {@link AlertEvent} carries
 * none). All colours / typography / spacing come from `useTheme`; no raw hex.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../hooks/useTheme';
import type { AlertEvent, AlertType } from './alertTypes';

/** Human-readable label per alert type. */
const LABEL_BY_TYPE: Record<AlertType, string> = {
  cry: 'Crying',
  motion: 'Movement',
  noise: 'Noise',
  no_motion: 'No movement',
};

/** Format an epoch-ms snooze deadline as a local `HH:MM` clock time. */
function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export interface LastAlertIndicatorProps {
  /** The most recent alert, or `null` when none has fired this session. */
  readonly alert: AlertEvent | null;
  /**
   * Epoch ms the snooze runs until, or `null` when not snoozed (DMY-28). When
   * set, a "Snoozed until HH:MM" badge is shown.
   */
  readonly snoozedUntil?: number | null;
  /**
   * Long-press handler that triggers a snooze (DMY-28). When provided the
   * banner becomes a `Pressable`; omit it for a plain, non-interactive readout.
   */
  readonly onSnoozeGesture?: () => void;
}

function LastAlertIndicator({
  alert,
  snoozedUntil = null,
  onSnoozeGesture,
}: LastAlertIndicatorProps) {
  const theme = useTheme();

  const label = alert ? LABEL_BY_TYPE[alert.type] : 'No alerts yet';
  const active = alert !== null;
  const isSnoozed = snoozedUntil !== null;

  // Snoozed alerts are de-emphasised (muted colour) since they are silenced;
  // an active, non-snoozed alert uses the danger colour to draw the eye.
  const accent = isSnoozed
    ? theme.colors.textMuted
    : active
    ? theme.colors.danger
    : theme.colors.border;

  const accessibilityLabel = isSnoozed
    ? `Alerts snoozed until ${formatClock(snoozedUntil)}`
    : active
    ? `Last alert: ${label}`
    : 'No alerts yet';

  const hint = onSnoozeGesture
    ? 'Long-press to snooze alerts'
    : undefined;

  const containerStyle = [
    styles.container,
    {
      gap: theme.spacing.xs,
      backgroundColor: theme.colors.surface,
      borderColor: active && !isSnoozed ? theme.colors.danger : theme.colors.border,
      borderRadius: theme.spacing.xs,
      padding: theme.spacing.sm,
    },
  ];

  const body = (
    <>
      <Text
        style={[
          styles.label,
          {
            color: isSnoozed
              ? theme.colors.textMuted
              : active
              ? theme.colors.danger
              : theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.sm,
            fontWeight: theme.typography.fontWeights.semibold,
          },
        ]}
      >
        {label}
      </Text>
      {isSnoozed ? (
        <Text
          testID="snooze-badge"
          style={[
            styles.badge,
            {
              color: accent,
              fontSize: theme.typography.fontSizes.xs,
              fontWeight: theme.typography.fontWeights.medium,
            },
          ]}
        >
          {`Snoozed until ${formatClock(snoozedUntil)}`}
        </Text>
      ) : null}
    </>
  );

  if (onSnoozeGesture) {
    return (
      <Pressable
        testID="last-alert-indicator"
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={hint}
        onLongPress={onSnoozeGesture}
        style={containerStyle}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View
      testID="last-alert-indicator"
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={containerStyle}
    >
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {},
  badge: {},
});

export default LastAlertIndicator;
