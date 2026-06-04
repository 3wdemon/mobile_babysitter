/**
 * useMediaSession — the end-to-end audio+video media session for the screens
 * (DMY-45, part 2).
 *
 * The bottom-up layers shipped one-way audio (DMY-18) and one-way video (DMY-17)
 * as SEPARATE hooks, each wrapping its own {@link useSignaling}. A real monitor
 * needs ONE peer connection carrying BOTH the baby's audio and video tracks, so
 * this hook runs a SINGLE signalling session and:
 *
 *  - **baby-unit (responder):** on the freshly-created peer connection (before
 *    the answer), captures the camera+mic at 1080p (one {@link getLocalVideoStream}
 *    capture carries both), publishes the audio track and the video track, keeps
 *    the video sender for the real {@link VideoTrackController} (audio-only
 *    pause/resume) and adaptive bitrate, and feeds a `getStats`-backed
 *    {@link BandwidthSignalSource} so quality steps down under load WITHOUT a
 *    reconnect (AC #2). The camera + mic are released on stop/`bye`/unmount
 *    (AC #3, no capture leak).
 *  - **parent-unit (initiator):** on real `ontrack` events, routes the audio
 *    stream to the {@link AudioPlayback} controller and exposes the video stream
 *    (+ its `streamURL`) for `RTCView`. Both flip true only on a genuine track
 *    arrival — never fabricated.
 *
 * This composes the existing testable primitives rather than reimplementing
 * them; useAudioStream / useVideoStream remain for single-medium use. The
 * transport is INJECTED (useSignalingTransport builds the real one); with none
 * the hook stays inert.
 *
 * ## Honest boundaries
 * Real capture / playback / sender shaping run against the injected seams (real
 * in prod, fakes in tests). Two phones exchanging live frames over a network is
 * a device milestone; every seam used to do it is real.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useAppStore } from '../../store/useAppStore';
import {
  type AndroidAudioService,
  createAndroidAudioService,
} from './androidAudioService';
import {
  assertEncryptedMediaProfile,
  extractRemoteAudioStream,
  setStreamAudioEnabled,
  stopStream,
} from './audioStream';
import { createSafeAudioPlayback } from './audioPlayback';
import { createIosAudioPlayback } from './iosAudioPlayback';
import { createTalkbackController, getTalkbackAudioStream } from './talkback';
import type { TalkbackController } from './talkback';
import { createGetStatsBandwidthSource } from './bandwidthSource';
import type { RtcStatsReportLike } from './bandwidthSource';
import {
  VIDEO_QUALITY_LADDER,
  extractRemoteVideoStream,
  getLocalVideoStream,
  nextQualityIndex,
  setVideoBitrate,
  streamUrlOf,
  videoTracksOf,
} from './videoStream';
import { createSenderVideoTrackController } from './videoTrackController';
import { useSignaling } from './useSignaling';
import {
  pushAlertsToChannel,
  receiveAlertsFromChannel,
} from '../alerts/alertChannel';
import type {
  AlertChannelReceiverOptions,
  AlertChannelSource,
} from '../alerts/alertChannel';
import type { AudioPlayback } from './audioPlayback';
import type { BandwidthSignal, BandwidthSignalSource } from './videoStream';
import type {
  MediaDevicesLike,
  MediaEncryptionProfile,
  MediaStreamLike,
  RtpSenderLike,
} from './mediaTypes';
import type { DataChannel, PeerConnection } from './signalingTypes';
import type { VideoTrackController } from './types';
import type { UseSignalingOptions, UseSignalingState } from './useSignaling';

/** Options for {@link useMediaSession}. */
export interface UseMediaSessionOptions
  extends Omit<
    UseSignalingOptions,
    'onPeerConnection' | 'onRemoteTrack' | 'onAlertChannel'
  > {
  /**
   * Parent-unit alert sinks (DMY-71). When set, the live alert data channel
   * (DMY-50) — opened by the baby and received here via the `datachannel` event —
   * is wired to {@link receiveAlertsFromChannel}, so an alert raised on the baby
   * fires a local notification (presenter, DMY-46) + haptic (DMY-28) on the
   * parent IN-SESSION. Omit to leave the channel unwired on this side.
   */
  readonly alertReceiver?: AlertChannelReceiverOptions;
  /**
   * Baby-unit alert source (DMY-71). When set, the live alert data channel this
   * baby opens is fed every raised {@link AlertEvent} from this source via
   * {@link pushAlertsToChannel}. The real producer is the alert pipeline
   * (cry detection DMY-49 / motion DMY-25); until that detector is exposed as a
   * stream, a call site may drive a source itself. Omit to open the channel
   * without pushing yet.
   */
  readonly alertSource?: AlertChannelSource;
  /** Media-devices source for baby-unit capture. Omit for the real one. */
  readonly mediaDevices?: MediaDevicesLike;
  /**
   * Parent-unit audio playback / routing controller. Omit to use the PLATFORM
   * default: on iOS the background-audio AVAudioSession controller (DMY-48/74)
   * so remote audio survives the screen locking; on Android / under Jest the
   * shared safe no-op (Android background audio is the separate
   * {@link foregroundAudioService} foreground-service seam). An explicitly-passed
   * controller (a test fake, or a call site selecting per platform) always wins
   * over the default.
   */
  readonly playback?: AudioPlayback;
  /**
   * Parent-unit Android background-audio foreground-service controller (DMY-23).
   * Started when remote audio begins and stopped on teardown/unmount so playback
   * survives backgrounding. Omit for the REAL Android service (a safe no-op on
   * iOS / under Jest); tests inject a fake.
   */
  readonly foregroundAudioService?: AndroidAudioService;
  /** Start the parent muted. Defaults to `false`. */
  readonly initiallyMuted?: boolean;
  /**
   * Bandwidth source driving adaptive bitrate (baby-unit). Omit to use a REAL
   * `getStats`-backed source over the live peer connection; tests inject a fake.
   */
  readonly bandwidth?: BandwidthSignalSource;
  /** Whether the baby starts transmitting video. Defaults to `true`. */
  readonly videoEnabled?: boolean;
  /**
   * Enable two-way talk (parent→baby push-to-talk, DMY-20/76). When set, the
   * PARENT (initiator) — which otherwise publishes nothing on this hook — also
   * captures its OWN microphone (with native echo cancellation,
   * {@link TALK_AUDIO_CONSTRAINTS}) and publishes a DISABLED push-to-talk track
   * onto the SAME peer connection that carries the baby's audio+video, so the
   * parent→baby audio m-line is part of the initial negotiation. The track stays
   * silent until {@link UseMediaSessionState.startTalking} is held (half-duplex).
   * Ignored on the baby-unit (which captures via the broadcast fan-out instead).
   * Defaults to `false` (receive-only parent).
   */
  readonly enableTalkback?: boolean;
}

/** Value returned by {@link useMediaSession}. */
export interface UseMediaSessionState extends UseSignalingState {
  /** Parent-unit: remote video stream URL for `RTCView`, or `null`. */
  readonly remoteStreamUrl: string | null;
  /** Parent-unit: whether a real remote video track has arrived. */
  readonly hasRemoteVideo: boolean;
  /** Parent-unit: whether a real remote audio track has arrived. */
  readonly hasRemoteAudio: boolean;
  /** Parent-unit: whether playback is active. */
  readonly playing: boolean;
  /** Parent-unit: whether playback is muted. */
  readonly muted: boolean;
  /** Parent-unit: toggle playback mute. */
  readonly setMuted: (muted: boolean) => void;
  /** Baby-unit: the real sender-backed video controller (audio-only), or `null`. */
  readonly videoController: VideoTrackController | null;
  /** The negotiated media security profile (DTLS-SRTP), or `null`. */
  readonly mediaEncrypted: MediaEncryptionProfile | null;
  /**
   * Two-way talk (DMY-76). Whether talkback was enabled for this session (the
   * `enableTalkback` option). When false, `talking` stays false and the talk
   * controls are no-ops.
   */
  readonly talkbackEnabled: boolean;
  /**
   * Parent-unit: whether the push-to-talk capture has been acquired and a track
   * published, so the talk button can leave its disabled state. True ONLY after
   * a real capture — never fabricated; always false on the baby-unit.
   */
  readonly talkReady: boolean;
  /**
   * Parent-unit: whether the parent is CURRENTLY talking (push-to-talk held —
   * the outgoing talk track is enabled / transmitting). Driven by the real
   * track's enabled flag via the controller, never fabricated.
   */
  readonly talking: boolean;
  /**
   * Parent-unit: begin transmitting the parent's voice to the baby (call on
   * press-in of the talk button). No-op until the talk capture is ready, on the
   * baby-unit, or when talkback is disabled.
   */
  readonly startTalking: () => void;
  /**
   * Parent-unit: stop transmitting (call on press-out of the talk button).
   * No-op when not talking / talkback disabled.
   */
  readonly stopTalking: () => void;
}

export function useMediaSession(
  options: UseMediaSessionOptions = {},
): UseMediaSessionState {
  const {
    mediaDevices,
    playback,
    foregroundAudioService,
    initiallyMuted = false,
    bandwidth,
    videoEnabled = true,
    enableTalkback = false,
    alertReceiver,
    alertSource,
    ...signalingOptions
  } = options;

  // Resolve the parent-unit playback controller once. An explicitly-injected
  // `playback` (a test fake, or a call site that selects per platform) ALWAYS
  // wins; with none we fall back to the platform default: on iOS the
  // background-audio AVAudioSession controller (DMY-48/74) so remote audio keeps
  // playing with the screen locked, elsewhere (Android / Jest) the shared safe
  // no-op (Android background audio is handled by the SEPARATE foreground-service
  // seam below). createIosAudioPlayback itself degrades to the no-op off iOS, so
  // this branch never produces a live iOS session under Jest / on Android.
  const resolvedPlayback = useMemo(
    () =>
      playback ?? (Platform.OS === 'ios' ? createIosAudioPlayback() : undefined),
    [playback],
  );

  const role = useAppStore(s => s.role);

  const [remoteStreamUrl, setRemoteStreamUrl] = useState<string | null>(null);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [hasRemoteAudio, setHasRemoteAudio] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMutedState] = useState(initiallyMuted);
  const [videoController, setVideoController] =
    useState<VideoTrackController | null>(null);
  const [mediaEncrypted, setMediaEncrypted] =
    useState<MediaEncryptionProfile | null>(null);
  const [qualityIndex, setQualityIndex] = useState(0);
  // Two-way talk (DMY-76): the parent push-to-talk live state.
  const [talkReady, setTalkReady] = useState(false);
  const [talking, setTalking] = useState(false);

  // Baby-unit live refs (read by cleanup / signals without re-rendering).
  const localStreamRef = useRef<MediaStreamLike | null>(null);
  const peerRef = useRef<PeerConnection | null>(null);
  const senderRef = useRef<RtpSenderLike | null>(null);
  // Parent push-to-talk controller (DMY-76) — null until the talk capture is
  // acquired. Held in a ref so press-in/press-out + cleanup reach the real track
  // without re-rendering.
  const talkbackRef = useRef<TalkbackController | null>(null);

  // Stable refs for inputs read inside identity-stable signalling callbacks.
  const roleRef = useRef(role);
  roleRef.current = role;
  const mediaDevicesRef = useRef(mediaDevices);
  mediaDevicesRef.current = mediaDevices;
  const videoEnabledRef = useRef(videoEnabled);
  videoEnabledRef.current = videoEnabled;
  const enableTalkbackRef = useRef(enableTalkback);
  enableTalkbackRef.current = enableTalkback;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const qualityIndexRef = useRef(qualityIndex);
  qualityIndexRef.current = qualityIndex;
  const alertReceiverRef = useRef(alertReceiver);
  alertReceiverRef.current = alertReceiver;
  const alertSourceRef = useRef(alertSource);
  alertSourceRef.current = alertSource;

  const safePlayback = useMemo(
    () => createSafeAudioPlayback(resolvedPlayback),
    [resolvedPlayback],
  );
  const playbackRef = useRef(safePlayback);
  playbackRef.current = safePlayback;

  // Android background-audio foreground service (DMY-23): the REAL Android
  // controller by default (a safe no-op on iOS / under Jest); tests inject a
  // fake. Started when the parent's remote audio attaches and stopped on
  // teardown/unmount so playback survives the screen locking. Resolved once so
  // the stable ref can be read inside the identity-stable signalling callbacks.
  const foregroundAudio = useMemo(
    () => foregroundAudioService ?? createAndroidAudioService(),
    [foregroundAudioService],
  );
  const foregroundAudioRef = useRef(foregroundAudio);
  foregroundAudioRef.current = foregroundAudio;

  // baby-unit: ONE capture carries camera + mic; publish both tracks onto the
  // single peer connection BEFORE the answer is negotiated.
  const onPeerConnection = useCallback(async (pc: PeerConnection) => {
    peerRef.current = pc;
    if (roleRef.current !== 'baby') {
      // parent-unit: receive-only by default. With two-way talk enabled
      // (DMY-76) the parent ALSO captures its OWN mic (echo-cancelled) and
      // publishes a DISABLED push-to-talk track onto THIS — the very same — peer
      // connection that carries the baby's audio+video, so the parent→baby audio
      // m-line is part of the initial negotiation. The track stays silent until
      // the parent holds the talk button (half-duplex push-to-talk).
      if (!enableTalkbackRef.current) {
        return;
      }
      const talkStream = await getTalkbackAudioStream(
        mediaDevicesRef.current ?? null,
      );
      const controller = createTalkbackController(talkStream, next =>
        setTalking(next),
      );
      talkbackRef.current = controller;
      for (const track of talkStream.getTracks()) {
        if (track.kind === 'audio') {
          // Already disabled by the controller; added so the m-line negotiates.
          pc.addAudioTrack(track, talkStream);
        }
      }
      setTalkReady(true);
      return;
    }
    const capture = await getLocalVideoStream(mediaDevicesRef.current ?? null);
    localStreamRef.current = capture.stream;

    // Publish the audio track(s) so the parent hears the room.
    for (const track of capture.stream.getTracks()) {
      if (track.kind === 'audio') {
        pc.addAudioTrack(track, capture.stream);
      }
    }

    // Publish the video track and keep its sender for control + adaptive bitrate.
    const [videoTrack] = videoTracksOf(capture.stream);
    if (videoTrack) {
      const sender = pc.addVideoTrack(videoTrack, capture.stream);
      senderRef.current = sender;
      const controller = createSenderVideoTrackController({
        sender,
        track: videoTrack,
      });
      if (!videoEnabledRef.current) {
        controller.disableVideo();
      }
      setVideoController(controller);
      await setVideoBitrate(sender, VIDEO_QUALITY_LADDER[0]);
    }
  }, []);

  const onLocalDescription = useCallback((description: { sdp: string }) => {
    setMediaEncrypted(assertEncryptedMediaProfile(description.sdp));
  }, []);

  // parent-unit: route a real remote track. One `ontrack` fires per medium, so
  // we inspect each and attach audio→playback, video→render independently.
  const onRemoteTrack = useCallback((event: unknown) => {
    if (roleRef.current === 'baby') {
      return;
    }
    const audio = extractRemoteAudioStream(event as never);
    if (audio) {
      setStreamAudioEnabled(audio, !mutedRef.current);
      playbackRef.current.start(audio);
      // Promote to an Android foreground service so remote audio keeps playing
      // when the parent device backgrounds / locks (DMY-23). No-op off Android.
      foregroundAudioRef.current.start();
      setHasRemoteAudio(true);
      setPlaying(true);
      return;
    }
    const video = extractRemoteVideoStream(event as never);
    if (video) {
      setRemoteStreamUrl(streamUrlOf(video));
      setHasRemoteVideo(true);
    }
  }, []);

  // Alert data channel wiring (DMY-71). The session owns the channel lifecycle
  // and hands the ready channel here; we bind it BY ROLE to the alerts feature:
  //   - parent (initiator): drive receiveAlertsFromChannel → local notification
  //     (DMY-46) + haptic (DMY-28).
  //   - baby (responder): feed every raised AlertEvent over the channel from the
  //     injected source (cry detection DMY-49 / motion, when exposed).
  // The returned cleanup detaches the listener on teardown; the session closes
  // the channel itself and re-invokes this with a fresh channel on a reconnect.
  const onAlertChannel = useCallback((channel: DataChannel) => {
    if (roleRef.current === 'baby') {
      const source = alertSourceRef.current;
      if (!source) {
        return;
      }
      return pushAlertsToChannel(channel, source);
    }
    // Parent: receive alerts and fire the in-session notification + haptic.
    return receiveAlertsFromChannel(channel, alertReceiverRef.current);
  }, []);

  const signaling = useSignaling({
    ...signalingOptions,
    onPeerConnection,
    onLocalDescription,
    onRemoteTrack,
    onAlertChannel,
  });

  const status = signaling.status;
  useEffect(() => {
    if (status === 'idle') {
      setMediaEncrypted(null);
    }
  }, [status]);

  // Mute toggle (parent).
  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    playbackRef.current.setMuted(next);
  }, []);

  // Push-to-talk (DMY-76): enable/disable the parent's outgoing talk track. Both
  // are no-ops until the talk capture is ready (controller acquired) — they
  // NEVER fabricate a talking state; `talking` is driven by the real track flag
  // via the controller's onTalkingChange callback.
  const startTalking = useCallback(() => {
    talkbackRef.current?.startTalking();
  }, []);
  const stopTalking = useCallback(() => {
    talkbackRef.current?.stopTalking();
  }, []);

  // --- Adaptive bitrate (baby) ---------------------------------------------
  useEffect(() => {
    const sender = senderRef.current;
    if (!sender) {
      return;
    }
    setVideoBitrate(sender, VIDEO_QUALITY_LADDER[qualityIndex]).catch(() => {});
  }, [qualityIndex]);

  const onBandwidthSignal = useCallback((signal: BandwidthSignal) => {
    if (roleRef.current !== 'baby' || signal === 'hold') {
      return;
    }
    const direction = signal === 'low' ? 'down' : 'up';
    const next = nextQualityIndex(qualityIndexRef.current, direction);
    if (next !== qualityIndexRef.current) {
      qualityIndexRef.current = next;
      setQualityIndex(next);
    }
  }, []);

  // Subscribe to the bandwidth source on the baby: injected one, else a REAL
  // getStats-backed source over the live connection (AC #2). setParameters
  // reshapes the LIVE sender — the connection is never recreated.
  const isBaby = role === 'baby';
  const isActive = signaling.isActive;
  useEffect(() => {
    if (!isBaby) {
      return;
    }
    if (bandwidth) {
      return bandwidth.subscribe(onBandwidthSignal);
    }
    const pc = peerRef.current;
    if (!pc) {
      return;
    }
    const source = createGetStatsBandwidthSource({
      read: () => pc.getStats() as Promise<RtcStatsReportLike>,
    });
    return source.subscribe(onBandwidthSignal);
  }, [isBaby, bandwidth, onBandwidthSignal, isActive]);

  // Release media on a true active→inactive transition (stop / failure / bye).
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (isActive) {
      wasActiveRef.current = true;
      return;
    }
    if (!wasActiveRef.current) {
      return;
    }
    wasActiveRef.current = false;
    if (localStreamRef.current) {
      stopStream(localStreamRef.current); // releases camera + mic
      localStreamRef.current = null;
    }
    if (talkbackRef.current) {
      // Release the parent talk mic (stops the track) — no capture leak.
      talkbackRef.current.dispose();
      talkbackRef.current = null;
      setTalking(false);
      setTalkReady(false);
    }
    senderRef.current = null;
    peerRef.current = null;
    setVideoController(null);
    if (playing) {
      safePlayback.stop();
      // Tear the Android foreground service down so its notification clears and
      // the OS reclaims the foreground slot (DMY-23). No-op off Android.
      foregroundAudioRef.current.stop();
      setPlaying(false);
      setHasRemoteAudio(false);
    }
    setRemoteStreamUrl(null);
    setHasRemoteVideo(false);
    setQualityIndex(0);
  }, [isActive, playing, safePlayback]);

  // Hard safety net on TRUE unmount: release capture + playback even if active
  // never flipped (an unmount mid-session). No camera/mic leak (AC #3).
  useEffect(() => {
    return () => {
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
      // Release the parent talk mic on a mid-session unmount (no capture leak).
      talkbackRef.current?.dispose();
      talkbackRef.current = null;
      senderRef.current = null;
      peerRef.current = null;
      playbackRef.current.stop();
      // Hard safety net: release the foreground service on a mid-session unmount
      // even if `playing` never flipped, so no orphaned notification lingers.
      foregroundAudioRef.current.stop();
    };
  }, []);

  return {
    ...signaling,
    remoteStreamUrl,
    hasRemoteVideo,
    hasRemoteAudio,
    playing,
    muted,
    setMuted,
    videoController,
    mediaEncrypted,
    talkbackEnabled: enableTalkback,
    talkReady,
    talking,
    startTalking,
    stopTalking,
  };
}
