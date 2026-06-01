/**
 * ParentMediaView — parent-unit media surface + audio-only toggle (DMY-24).
 *
 * Renders the parent's view of the monitored room:
 *  - In AUDIO-ONLY mode: a dark placeholder ("Audio-only · tap to see video")
 *    instead of a video view. The remote video track is NOT requested
 *    (useAudioOnlyMode keeps it disabled), saving bandwidth + battery. Tapping
 *    the placeholder momentarily PEEKS at the picture.
 *  - While PEEKING (or in full video mode): a video surface placeholder is
 *    shown. There is NO real remote video yet — the live WebRTC stream lands in
 *    DMY-16/17/18 — so this is an honest "video unavailable / placeholder" view,
 *    not a faked stream. A "Back to audio-only" affordance ends the peek.
 *
 * A toggle lets the user switch audio-only on/off (persisted in the store).
 *
 * Rendered against the DARK / night palette: the parent watches in a dark
 * bedroom, so we resolve `useTheme('dark')` explicitly. All colours/typography/
 * spacing come from tokens; no raw hex.
 */
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../../hooks/useTheme';
import { useAppStore } from '../../store/useAppStore';
import { useAudioOnlyMode } from './useAudioOnlyMode';
import type { VideoTrackController } from './types';

export interface ParentMediaViewProps {
  /**
   * Video-track controller (DMY-17). Omit for the safe no-op used until the
   * WebRTC layer is wired. Exposed mainly so tests can inject a spy.
   */
  readonly controller?: VideoTrackController;
}

function ParentMediaView({ controller }: ParentMediaViewProps) {
  // Night palette: the parent watches in a dark room.
  const theme = useTheme('dark');
  const audioOnlyEnabled = useAppStore(s => s.settings.audioOnlyEnabled);
  const setAudioOnlyEnabled = useAppStore(s => s.setAudioOnlyEnabled);

  const { mode, isPeeking, showVideo, hideVideo } = useAudioOnlyMode({
    controller,
  });

  const showingVideo = mode === 'video';

  return (
    <View
      testID="parent-media-view"
      style={[styles.container, { gap: theme.spacing.md }]}
    >
      {showingVideo ? (
        // Video surface placeholder — the live WebRTC stream is DMY-16/17/18.
        <View
          testID="parent-video-surface"
          style={[
            styles.surface,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.spacing.md,
            },
          ]}
        >
          <Text
            style={[
              styles.surfaceLabel,
              {
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSizes.sm,
                lineHeight: theme.typography.lineHeights.sm,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}
          >
            {isPeeking ? 'Video · peeking' : 'Video'}
          </Text>
          <Text
            style={[
              styles.surfaceHint,
              {
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSizes.xs,
                lineHeight: theme.typography.lineHeights.xs,
              },
            ]}
          >
            The live picture appears here once the connection is up.
          </Text>

          {isPeeking ? (
            <TouchableOpacity
              accessibilityRole="button"
              testID="parent-hide-video"
              style={[
                styles.peekAction,
                {
                  borderColor: theme.colors.border,
                  borderRadius: theme.spacing.sm,
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.lg,
                  marginTop: theme.spacing.md,
                },
              ]}
              onPress={hideVideo}
            >
              <Text
                style={[
                  styles.peekActionLabel,
                  {
                    color: theme.colors.text,
                    fontSize: theme.typography.fontSizes.sm,
                    fontWeight: theme.typography.fontWeights.semibold,
                  },
                ]}
              >
                Back to audio-only
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        // Audio-only placeholder — video is NOT requested. Tap to peek.
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Audio-only — tap to see video"
          testID="parent-audio-only-placeholder"
          activeOpacity={0.8}
          style={[
            styles.surface,
            {
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.border,
              borderRadius: theme.spacing.md,
            },
          ]}
          onPress={showVideo}
        >
          <Text
            style={[
              styles.surfaceLabel,
              {
                color: theme.colors.success,
                fontSize: theme.typography.fontSizes.sm,
                lineHeight: theme.typography.lineHeights.sm,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}
          >
            Audio-only
          </Text>
          <Text
            style={[
              styles.surfaceHint,
              {
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSizes.xs,
                lineHeight: theme.typography.lineHeights.xs,
              },
            ]}
          >
            Listening with the screen dark to save battery and data. Tap to see
            the video for a moment.
          </Text>
        </TouchableOpacity>
      )}

      <View
        style={[
          styles.toggleRow,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.spacing.md,
            padding: theme.spacing.lg,
          },
        ]}
      >
        <Text
          style={[
            styles.toggleLabel,
            {
              color: theme.colors.text,
              fontSize: theme.typography.fontSizes.sm,
              fontWeight: theme.typography.fontWeights.semibold,
            },
          ]}
        >
          Audio-only (low power)
        </Text>
        <Switch
          testID="audio-only-toggle"
          accessibilityRole="switch"
          accessibilityLabel="Audio-only mode"
          value={audioOnlyEnabled}
          onValueChange={setAudioOnlyEnabled}
          trackColor={{
            false: theme.colors.border,
            true: theme.colors.primary,
          }}
          thumbColor={theme.colors.onPrimary}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  surface: {
    width: '100%',
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  surfaceLabel: {
    textAlign: 'center',
  },
  surfaceHint: {
    textAlign: 'center',
    marginTop: 8,
  },
  peekAction: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  peekActionLabel: {},
  toggleRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleLabel: {
    flexShrink: 1,
  },
});

export default ParentMediaView;
