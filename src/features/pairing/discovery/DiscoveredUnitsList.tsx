/**
 * DiscoveredUnitsList — parent-unit list of baby-units found on the LAN (DMY-7).
 *
 * A QR-free alternative to scanning: when both phones are on the same Wi-Fi,
 * the parent sees the baby-units that are advertising themselves over mDNS and
 * can tap one to pair with its session id. Presentational + a single
 * `onSelect(sessionId)` callback; the discovery/list state comes from
 * {@link useDiscoveredUnits} (the screen owns it) and the pairing side effect
 * lives in the scanner hook (same `paired` flow as the QR path).
 *
 * Three-way state (DMY-59), driven by `scanning` / `settled` / `units`:
 *  - browsing with nothing resolved yet -> shared {@link LoadingState};
 *  - browse settled with zero units     -> shared {@link EmptyState} + guidance;
 *  - one or more units                  -> the tappable list.
 *
 * Honest scope: tapping a unit records `paired` (sessionId), it does NOT open a
 * media connection — WebRTC signalling is DMY-16/18.
 *
 * All colours/typography/spacing come from design tokens via `useTheme`.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import EmptyState from '../../../components/EmptyState';
import LoadingState from '../../../components/LoadingState';
import { useTheme } from '../../../hooks/useTheme';
import type { DiscoveredBabyUnit } from './types';

export interface DiscoveredUnitsListProps {
  /** Resolved baby-units to show (from useDiscoveredUnits). */
  readonly units: readonly DiscoveredBabyUnit[];
  /** Whether a browse is currently active (drives the loading state). */
  readonly scanning: boolean;
  /**
   * Whether the browse has settled (a unit resolved, or the grace window
   * elapsed). While `scanning && !settled` with no units we show the loading
   * state; once `settled` with no units we show the empty state. Defaults to
   * `true` so older callers that have units (or no scan) behave as before.
   */
  readonly settled?: boolean;
  /** Called with the chosen unit's sessionId when the user taps it. */
  readonly onSelect: (sessionId: string) => void;
}

function DiscoveredUnitsList({
  units,
  scanning,
  settled = true,
  onSelect,
}: DiscoveredUnitsListProps) {
  const theme = useTheme();

  const hasUnits = units.length > 0;
  // Loading: actively browsing, nothing resolved yet, and not settled.
  const loading = !hasUnits && scanning && !settled;

  return (
    <View testID="discovered-units" style={styles.container}>
      <Text
        accessibilityRole="header"
        style={[
          styles.heading,
          {
            color: theme.colors.text,
            fontSize: theme.typography.fontSizes.md,
            fontWeight: theme.typography.fontWeights.semibold,
            marginBottom: theme.spacing.sm,
          },
        ]}
      >
        Baby units on this network
      </Text>

      {hasUnits ? (
        units.map(unit => (
          <TouchableOpacity
            key={unit.name}
            accessibilityRole="button"
            testID={`discovered-unit-${unit.sessionId}`}
            onPress={() => onSelect(unit.sessionId)}
            style={[
              styles.row,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.spacing.sm,
                paddingVertical: theme.spacing.md,
                paddingHorizontal: theme.spacing.lg,
                marginBottom: theme.spacing.sm,
              },
            ]}
          >
            <Text
              style={[
                styles.rowTitle,
                {
                  color: theme.colors.text,
                  fontSize: theme.typography.fontSizes.md,
                  fontWeight: theme.typography.fontWeights.semibold,
                },
              ]}
            >
              {unit.name}
            </Text>
            <Text
              style={[
                styles.rowHint,
                {
                  color: theme.colors.textMuted,
                  fontSize: theme.typography.fontSizes.xs,
                  lineHeight: theme.typography.lineHeights.xs,
                },
              ]}
            >
              Tap to pair over Wi-Fi
            </Text>
          </TouchableOpacity>
        ))
      ) : loading ? (
        <LoadingState
          testID="discovered-loading"
          message="Looking for baby units on your Wi-Fi…"
        />
      ) : (
        <EmptyState
          testID="discovered-empty"
          icon="📡"
          title={
            scanning ? 'No baby units found yet' : 'Network discovery is off'
          }
          description={
            scanning
              ? 'Make sure the baby phone is on the same Wi-Fi and showing its pairing screen, or scan the QR code below.'
              : 'Scan the QR code below to pair this parent unit.'
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  heading: {},
  row: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: {},
  rowHint: {},
});

export default DiscoveredUnitsList;
