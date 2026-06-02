/**
 * AudioRouteToggle — parent-unit audio-output selector (DMY-55).
 *
 * A horizontal segmented control letting the parent pick where the baby-unit's
 * monitor audio plays: the loud Speaker (room-fill, the overnight default), the
 * quiet Earpiece (discreet listening), or a connected Bluetooth device. The
 * actual switch is performed by the {@link AudioPlayback} controller via
 * `setRoute`; this component is purely presentational and CONTROLLED — the
 * caller owns the selected route and passes the available routes.
 *
 * Bluetooth handling (AC): the Bluetooth segment is HIDDEN whenever no Bluetooth
 * output is connected (`bluetooth` absent from `availableRoutes`). A quiet,
 * non-blocking hint explains why so the option's absence is not mysterious.
 *
 * Accessibility: each segment is a `button` whose `accessibilityState.selected`
 * announces the current choice; the label is the i18n `audioRoute.optionA11y`
 * string. Rendered against the DARK / night palette (the parent watches in a
 * dark bedroom), consistent with the other in-session controls.
 *
 * All colours/typography/spacing come from `useTheme`; all copy from the i18n
 * catalog (`audioRoute.*`). No hard-coded strings or hex values.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import {
  AUDIO_ROUTES,
  type AudioRoute,
} from '../features/webrtc/audioPlayback';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import type { ThemeMode } from '../theme';

export interface AudioRouteToggleProps {
  /** The currently-selected output route (reflected as the active segment). */
  readonly selectedRoute: AudioRoute;
  /**
   * Routes the user may pick from — typically the controller's
   * `getAvailableRoutes()`. `bluetooth` is present only when a Bluetooth device
   * is connected; when absent, its segment is hidden. Defaults to every route.
   */
  readonly availableRoutes?: readonly AudioRoute[];
  /** Called with the chosen route when a segment is pressed. */
  readonly onSelectRoute: (route: AudioRoute) => void;
  /** Theme selection passed through to `useTheme`. Defaults to night palette. */
  readonly mode?: ThemeMode;
}

function AudioRouteToggle({
  selectedRoute,
  availableRoutes = AUDIO_ROUTES,
  onSelectRoute,
  mode = 'dark',
}: AudioRouteToggleProps) {
  const theme = useTheme(mode);
  const { t } = useTranslation();

  const bluetoothAvailable = availableRoutes.includes('bluetooth');
  // Present the routes in their canonical order, dropping any not available
  // (i.e. Bluetooth when no device is connected).
  const visibleRoutes = AUDIO_ROUTES.filter(r => availableRoutes.includes(r));

  return (
    <View testID="audio-route-toggle" style={styles.root}>
      <Text
        testID="audio-route-label"
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
        {t('audioRoute.label')}
      </Text>

      <View style={styles.segmented}>
        {visibleRoutes.map(route => {
          const routeLabel = t(`audioRoute.routes.${route}`);
          const selected = route === selectedRoute;
          return (
            <TouchableOpacity
              key={route}
              testID={`audio-route-${route}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={
                selected
                  ? t('audioRoute.selectedA11y', { label: routeLabel })
                  : t('audioRoute.optionA11y', { label: routeLabel })
              }
              activeOpacity={0.85}
              onPress={() => onSelectRoute(route)}
              style={[
                styles.segment,
                {
                  borderColor: theme.colors.border,
                  borderRadius: theme.spacing.sm,
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.md,
                  marginRight: theme.spacing.xs,
                  backgroundColor: selected
                    ? theme.colors.primary
                    : theme.colors.surface,
                },
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  {
                    color: selected ? theme.colors.onPrimary : theme.colors.text,
                    fontSize: theme.typography.fontSizes.sm,
                    fontWeight: theme.typography.fontWeights.semibold,
                  },
                ]}
              >
                {routeLabel}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {!bluetoothAvailable ? (
        <Text
          testID="audio-route-bluetooth-hint"
          style={[
            styles.hint,
            {
              color: theme.colors.textMuted,
              fontSize: theme.typography.fontSizes.xs,
              lineHeight: theme.typography.lineHeights.xs,
              marginTop: theme.spacing.xs,
            },
          ]}
        >
          {t('audioRoute.bluetoothUnavailable')}
        </Text>
      ) : null}
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
  segmented: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentText: {
    textAlign: 'center',
  },
  hint: {
    textAlign: 'left',
  },
});

export default AudioRouteToggle;
