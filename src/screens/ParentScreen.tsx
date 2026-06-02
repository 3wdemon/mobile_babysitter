/**
 * ParentScreen — parent unit (monitoring side).
 *
 * Skeleton route for DMY-35. The first concrete step is QR pairing (DMY-14):
 * this screen renders the parent-unit pairing view that scans the baby unit's
 * QR code and records the paired session. Remote stream playback, alerts and
 * the rest of the monitoring UI arrive in later issues (DMY-16/17/18).
 *
 * DMY-10: the monitoring UI is wrapped in {@link ParentModeGate}, which puts a
 * biometric/PIN lock in front of it when `settings.biometricLockEnabled` is on.
 * When the setting is off (the default), the gate is a transparent pass-through
 * and behaviour is unchanged.
 *
 * DMY-55: during an active session the parent can pick the audio OUTPUT route
 * (speaker / earpiece / Bluetooth). The selection is driven through the
 * {@link AudioPlayback} controller's `setRoute`; the available routes (and thus
 * whether Bluetooth is offered) come from the controller. Until the native
 * audio session lands (DMY-48), the controller is the safe no-op: route changes
 * are honoured as no-ops and Bluetooth reports unavailable, so the toggle hides
 * the Bluetooth option. The seam is ready for the real controller to drop in.
 *
 * DMY-56: during an active session the parent can also adjust the playback
 * VOLUME (0..1). The level is persisted (`settings.playbackVolume`) and applied
 * live to the controller via `setVolume`; on connect the persisted volume is
 * (re-)applied so a restored preference actually takes effect. Volume 0 mutes
 * the output WITHOUT disconnecting the stream (see AudioPlayback.setVolume).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import AudioRouteToggle from '../components/AudioRouteToggle';
import ConnectionQualityIndicator from '../components/ConnectionQualityIndicator';
import OfflineIndicator from '../components/OfflineIndicator';
import VolumeSlider from '../components/VolumeSlider';
import ParentModeGate from '../features/auth/ParentModeGate';
import ParentPairingScreen from '../features/pairing/screens/ParentPairingScreen';
import {
  createSafeAudioPlayback,
  DEFAULT_AUDIO_ROUTE,
  type AudioPlayback,
  type AudioRoute,
} from '../features/webrtc';
import type { RootStackScreenProps } from '../navigation/types';
import { useAppStore } from '../store/useAppStore';

export interface ParentScreenProps extends RootStackScreenProps<'Parent'> {
  /**
   * Audio routing controller (DMY-55). Omit for the safe no-op (the shipped
   * default until the native session lands in DMY-48); tests inject a fake to
   * assert routing flows through the controller.
   */
  readonly playback?: AudioPlayback;
}

function ParentScreen({ playback }: ParentScreenProps) {
  const connectionStatus = useAppStore(s => s.connectionStatus);
  // The toggle is only meaningful once a live link exists — audio is flowing.
  const sessionActive = connectionStatus === 'connected';

  // Persisted playback volume + its setter (DMY-56).
  const playbackVolume = useAppStore(s => s.settings.playbackVolume);
  const setPlaybackVolume = useAppStore(s => s.setPlaybackVolume);

  // One wrapped controller per controller identity. With no controller this is
  // the safe no-op (Bluetooth unavailable, setRoute a no-op) until DMY-48.
  const controller = useMemo(
    () => createSafeAudioPlayback(playback),
    [playback],
  );
  const availableRoutes = useMemo(
    () => controller.getAvailableRoutes(),
    [controller],
  );

  const [selectedRoute, setSelectedRoute] =
    useState<AudioRoute>(DEFAULT_AUDIO_ROUTE);

  const onSelectRoute = useCallback(
    (route: AudioRoute) => {
      setSelectedRoute(route);
      // Fire-and-forget: the controller wrapper already swallows any sync/async
      // error (a rejected promise is absorbed inside createSafeAudioPlayback), so
      // there is nothing to await or catch here.
      controller.setRoute(route);
    },
    [controller],
  );

  // DMY-56: apply the persisted volume to the controller whenever a session
  // becomes active (so a RESTORED preference actually takes effect) or the
  // controller identity changes. The wrapper clamps + swallows any error.
  useEffect(() => {
    if (sessionActive) {
      controller.setVolume(playbackVolume);
    }
  }, [sessionActive, controller, playbackVolume]);

  const onVolumeChange = useCallback(
    (volume: number) => {
      // Persist the new level AND apply it live. The store clamps to [0,1] and
      // the controller wrapper clamps again defensively; setVolume(0) mutes the
      // output without disconnecting the stream.
      setPlaybackVolume(volume);
      controller.setVolume(volume);
    },
    [controller, setPlaybackVolume],
  );

  return (
    <ParentModeGate>
      <View style={styles.root}>
        {/* Top banner; renders nothing while online (DMY-60). */}
        <OfflineIndicator />
        {/*
         * 4-level link-quality indicator (DMY-53). `getStats` is intentionally
         * omitted for now: the full media pipeline (DMY-45) that supplies a real
         * RTT/loss `getStats` provider is not merged yet, so the indicator
         * degrades to the coarse `connectionStatus`-derived level. Once DMY-45
         * lands, pass its `getStats` here to get accurate stats-based levels.
         */}
        <View style={styles.quality}>
          <ConnectionQualityIndicator />
        </View>
        {/*
         * Audio output route toggle (DMY-55). Only shown during an active
         * session — there is no audio to route otherwise. Bluetooth is offered
         * only when the controller reports a connected device.
         */}
        {sessionActive ? (
          <View style={styles.audioRoute}>
            <AudioRouteToggle
              selectedRoute={selectedRoute}
              availableRoutes={availableRoutes}
              onSelectRoute={onSelectRoute}
            />
            {/*
             * Playback volume (DMY-56). Only shown during an active session —
             * there is no audio to attenuate otherwise. Volume 0 mutes the
             * output WITHOUT disconnecting (AudioPlayback.setVolume contract).
             */}
            <View style={styles.volume}>
              <VolumeSlider volume={playbackVolume} onChange={onVolumeChange} />
            </View>
          </View>
        ) : null}
        <View style={styles.body}>
          <ParentPairingScreen />
        </View>
      </View>
    </ParentModeGate>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  quality: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  audioRoute: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  volume: {
    marginTop: 12,
    alignSelf: 'stretch',
  },
  body: {
    flex: 1,
  },
});

export default ParentScreen;
