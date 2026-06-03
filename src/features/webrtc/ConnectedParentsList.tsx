/**
 * ConnectedParentsList — baby-unit view of the connected parents (DMY-66).
 *
 * The baby phone fans its stream out to up to {@link MAX_PARENTS} parents; this
 * component shows, on the baby-unit face, HOW MANY viewers are connected (and
 * each one's coarse status), plus a localised "viewer limit reached" notice when
 * the cap is hit (AC #3). It renders only NON-PII facts — an opaque per-viewer
 * index and a status word — never any identifying parent data.
 *
 * Rendered against the DARK / AOD palette to match the baby-unit face (like
 * {@link BatteryIndicator} / {@link PowerSaverIndicator}). All copy comes from
 * the i18n catalog (`webrtc.broadcast.*`); all colours/spacing from the theme.
 */
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import type { BroadcastParent } from './babyBroadcast';
import type { SignalingSessionStatus } from './signalingSession';
import type { ThemeMode } from '../../theme';

export interface ConnectedParentsListProps {
  /** The parents to render (id + coarse status). */
  readonly parents: readonly BroadcastParent[];
  /** The viewer cap, for the "N of MAX" copy. */
  readonly maxParents: number;
  /** Whether the cap was reached (shows the "monitor full" notice). */
  readonly capReached: boolean;
  /** Theme selection (defaults to the dark baby-unit face). */
  readonly mode?: ThemeMode;
}

/** Map a coarse session status onto its localised status word. */
function statusKey(status: SignalingSessionStatus): string {
  switch (status) {
    case 'connected':
      return 'webrtc.broadcast.statusConnected';
    case 'failed':
      return 'webrtc.broadcast.statusFailed';
    case 'disconnected':
      return 'webrtc.broadcast.statusDisconnected';
    case 'connecting':
    case 'idle':
    default:
      return 'webrtc.broadcast.statusConnecting';
  }
}

function ConnectedParentsList({
  parents,
  maxParents,
  capReached,
  mode = 'dark',
}: ConnectedParentsListProps) {
  const theme = useTheme(mode);
  const { t } = useTranslation();

  const connectedCount = parents.filter(p => p.status === 'connected').length;

  return (
    <View testID="connected-parents" style={styles.root}>
      <Text
        testID="connected-parents-title"
        style={{
          color: theme.colors.textMuted,
          fontSize: theme.typography.fontSizes.xs,
          fontWeight: theme.typography.fontWeights.semibold,
          marginBottom: theme.spacing.xs,
        }}
      >
        {t('webrtc.broadcast.title')}
      </Text>

      <Text
        testID="connected-parents-count"
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        style={{
          color: theme.colors.text,
          fontSize: theme.typography.fontSizes.sm,
          fontWeight: theme.typography.fontWeights.semibold,
        }}
      >
        {t('webrtc.broadcast.count', {
          count: connectedCount,
          max: maxParents,
        })}
      </Text>

      {parents.length === 0 ? (
        <Text
          testID="connected-parents-empty"
          style={{
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.xs,
            marginTop: theme.spacing.xs,
          }}
        >
          {t('webrtc.broadcast.none')}
        </Text>
      ) : (
        <View style={{ marginTop: theme.spacing.xs, gap: theme.spacing.xs }}>
          {parents.map((parent, index) => {
            const statusText = t(statusKey(parent.status));
            return (
              <View
                key={parent.clientId}
                testID={`connected-parent-${parent.clientId}`}
                accessibilityRole="text"
                accessibilityLabel={t('webrtc.broadcast.viewerA11y', {
                  index: index + 1,
                  status: statusText,
                })}
                style={[
                  styles.row,
                  {
                    gap: theme.spacing.sm,
                    paddingVertical: theme.spacing.xs,
                    paddingHorizontal: theme.spacing.sm,
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.border,
                    borderRadius: theme.spacing.sm,
                  },
                ]}
              >
                <View
                  testID={`connected-parent-dot-${parent.clientId}`}
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        parent.status === 'connected'
                          ? theme.colors.success
                          : parent.status === 'failed'
                          ? theme.colors.danger
                          : theme.colors.textMuted,
                    },
                  ]}
                />
                <Text
                  style={{
                    color: theme.colors.text,
                    fontSize: theme.typography.fontSizes.xs,
                  }}
                >
                  {t('webrtc.broadcast.viewerA11y', {
                    index: index + 1,
                    status: statusText,
                  })}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {capReached ? (
        <Text
          testID="connected-parents-full"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{
            color: theme.colors.danger,
            fontSize: theme.typography.fontSizes.xs,
            marginTop: theme.spacing.xs,
          }}
        >
          {t('webrtc.broadcast.full', { max: maxParents })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'flex-start',
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

export default ConnectedParentsList;
