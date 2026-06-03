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

import { useAppStore } from '../../store/useAppStore';
import {
  assertEncryptedMediaProfile,
  extractRemoteAudioStream,
  setStreamAudioEnabled,
  stopStream,
} from './audioStream';
import { createSafeAudioPlayback } from './audioPlayback';
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
import type { AudioPlayback } from './audioPlayback';
import type { BandwidthSignal, BandwidthSignalSource } from './videoStream';
import type {
  MediaDevicesLike,
  MediaEncryptionProfile,
  MediaStreamLike,
  RtpSenderLike,
} from './mediaTypes';
import type { PeerConnection } from './signalingTypes';
import type { VideoTrackController } from './types';
import type { UseSignalingOptions, UseSignalingState } from './useSignaling';

/** Options for {@link useMediaSession}. */
export interface UseMediaSessionOptions
  extends Omit<UseSignalingOptions, 'onPeerConnection' | 'onRemoteTrack'> {
  /** Media-devices source for baby-unit capture. Omit for the real one. */
  readonly mediaDevices?: MediaDevicesLike;
  /** Parent-unit audio playback / routing controller. Omit for the safe no-op. */
  readonly playback?: AudioPlayback;
  /** Start the parent muted. Defaults to `false`. */
  readonly initiallyMuted?: boolean;
  /**
   * Bandwidth source driving adaptive bitrate (baby-unit). Omit to use a REAL
   * `getStats`-backed source over the live peer connection; tests inject a fake.
   */
  readonly bandwidth?: BandwidthSignalSource;
  /** Whether the baby starts transmitting video. Defaults to `true`. */
  readonly videoEnabled?: boolean;
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
}

export function useMediaSession(
  options: UseMediaSessionOptions = {},
): UseMediaSessionState {
  const {
    mediaDevices,
    playback,
    initiallyMuted = false,
    bandwidth,
    videoEnabled = true,
    ...signalingOptions
  } = options;

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

  // Baby-unit live refs (read by cleanup / signals without re-rendering).
  const localStreamRef = useRef<MediaStreamLike | null>(null);
  const peerRef = useRef<PeerConnection | null>(null);
  const senderRef = useRef<RtpSenderLike | null>(null);

  // Stable refs for inputs read inside identity-stable signalling callbacks.
  const roleRef = useRef(role);
  roleRef.current = role;
  const mediaDevicesRef = useRef(mediaDevices);
  mediaDevicesRef.current = mediaDevices;
  const videoEnabledRef = useRef(videoEnabled);
  videoEnabledRef.current = videoEnabled;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const qualityIndexRef = useRef(qualityIndex);
  qualityIndexRef.current = qualityIndex;

  const safePlayback = useMemo(
    () => createSafeAudioPlayback(playback),
    [playback],
  );
  const playbackRef = useRef(safePlayback);
  playbackRef.current = safePlayback;

  // baby-unit: ONE capture carries camera + mic; publish both tracks onto the
  // single peer connection BEFORE the answer is negotiated.
  const onPeerConnection = useCallback(async (pc: PeerConnection) => {
    peerRef.current = pc;
    if (roleRef.current !== 'baby') {
      // The parent publishes nothing on this hook (talkback is a separate path).
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

  const signaling = useSignaling({
    ...signalingOptions,
    onPeerConnection,
    onLocalDescription,
    onRemoteTrack,
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
    senderRef.current = null;
    peerRef.current = null;
    setVideoController(null);
    if (playing) {
      safePlayback.stop();
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
      senderRef.current = null;
      peerRef.current = null;
      playbackRef.current.stop();
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
  };
}
