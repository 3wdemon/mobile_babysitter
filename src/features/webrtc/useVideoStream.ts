/**
 * useVideoStream — drive the one-way baby→parent VIDEO path (DMY-17).
 *
 * Mirrors {@link useAudioStream} (DMY-18) and wraps {@link useSignaling},
 * branching on the device `role`:
 *
 *  - **baby-unit (responder):** when the peer connection is created (before the
 *    answer is negotiated), captures the camera at 1080p via
 *    {@link getLocalVideoStream} (stepping down if the device cannot deliver it),
 *    publishes the video track sendonly with `addVideoTrack`, and keeps the
 *    returned `RTCRtpSender`. That sender is used for two things: the REAL
 *    {@link VideoTrackController} (so audio-only mode can pause/resume the
 *    outgoing video) and adaptive bitrate ({@link setVideoBitrate}). The camera
 *    is stopped (released) on stop/unmount — no capture leak.
 *
 *  - **parent-unit (initiator):** on a real `ontrack` event carrying video,
 *    extracts the remote `MediaStream` and exposes it (plus its `streamURL`) so
 *    `RTCView` can render it. `hasRemoteVideo` flips true ONLY on a genuine
 *    remote-track arrival — never fabricated.
 *
 * ## Adaptive bitrate (baby-unit), without a disconnect
 * The hook subscribes to an injected {@link BandwidthSignalSource} (abstracted
 * so it is testable with synthetic signals; production feeds it from `getStats`
 * / connection-state). On a sustained `'low'` signal it steps the quality ladder
 * DOWN and applies the new {@link VideoQualityProfile} via
 * {@link setVideoBitrate} — which reshapes the LIVE sender's encoding through
 * `setParameters` and NEVER renegotiates or recreates the connection. On `'ok'`
 * it steps back UP. The connection is untouched throughout.
 *
 * ## Encryption (DTLS-SRTP)
 * Video media is encrypted by construction; {@link assertEncryptedMediaProfile}
 * inspects every `m=` line (audio AND video) and is surfaced as `mediaEncrypted`
 * so a diagnostic/test can confirm the video m-line is SRTP.
 *
 * ## Honest boundaries
 *  - Real camera capture runs against the injected `mediaDevices`; real sender
 *    shaping runs against the real sender. No stream/sender/state is faked.
 *  - Two phones actually exchanging frames over a real network cannot be
 *    exercised here (no devices) — that is a manual milestone. Every seam used
 *    to do it is real.
 *
 * ## Privacy
 * No video frames, stream/track ids, or SDP are ever logged — only coarse
 * lifecycle facts and non-PII quality numbers through the redacting logger.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppStore } from '../../store/useAppStore';
import {
  assertEncryptedMediaProfile,
  stopStream,
} from './audioStream';
import {
  VIDEO_QUALITY_LADDER,
  bandwidthSignalForState,
  extractRemoteVideoStream,
  getLocalVideoStream,
  nextQualityIndex,
  setVideoBitrate,
  streamUrlOf,
  videoTracksOf,
} from './videoStream';
import { createSenderVideoTrackController } from './videoTrackController';
import { useSignaling } from './useSignaling';
import type {
  BandwidthSignal,
  BandwidthSignalSource,
  VideoQualityProfile,
} from './videoStream';
import type {
  MediaDevicesLike,
  MediaEncryptionProfile,
  MediaStreamLike,
  RtpSenderLike,
} from './mediaTypes';
import type { PeerConnection } from './signalingTypes';
import type { VideoTrackController } from './types';
import type { UseSignalingOptions, UseSignalingState } from './useSignaling';

/** Options for {@link useVideoStream}. */
export interface UseVideoStreamOptions
  extends Omit<UseSignalingOptions, 'onPeerConnection' | 'onRemoteTrack'> {
  /**
   * Media-devices source for baby-unit capture. Omit to use the real
   * react-native-webrtc `mediaDevices`; tests inject a fake. Ignored on the
   * parent-unit (which captures nothing).
   */
  readonly mediaDevices?: MediaDevicesLike;
  /**
   * Bandwidth-pressure source driving adaptive bitrate on the baby-unit. Omit to
   * derive a coarse signal from peer connection-state transitions (a
   * zero-dependency proxy); production may pass a richer `getStats`-backed
   * source. Ignored on the parent-unit.
   */
  readonly bandwidth?: BandwidthSignalSource;
  /**
   * Whether the baby-unit should start with video ENABLED (transmitting).
   * Defaults to `true`. The parent's audio-only mode controls the receive side
   * separately (useAudioOnlyMode); this gates the SEND side.
   */
  readonly videoEnabled?: boolean;
}

/** Value returned by {@link useVideoStream}. */
export interface UseVideoStreamState extends UseSignalingState {
  /**
   * Parent-unit: the remote video `MediaStream` to render, or `null` until a
   * real video `ontrack` arrives. Never fabricated.
   */
  readonly remoteStream: MediaStreamLike | null;
  /**
   * Parent-unit: the `streamURL` for `RTCView` (the remote stream's id), or
   * `null` when there is nothing to render.
   */
  readonly remoteStreamUrl: string | null;
  /** Parent-unit: whether a real remote video track has arrived. */
  readonly hasRemoteVideo: boolean;
  /**
   * The real, sender-backed {@link VideoTrackController} for the baby-unit's
   * outgoing video, or `null` before the track is published. Pass this to
   * useAudioOnlyMode so audio-only really pauses the SEND side. (On the parent
   * this stays `null`; the parent has no outgoing video.)
   */
  readonly videoController: VideoTrackController | null;
  /** The current adaptive-bitrate quality profile in effect (baby-unit). */
  readonly quality: VideoQualityProfile;
  /**
   * The negotiated media security profile (DTLS-SRTP), derived from the local
   * SDP after negotiation (covers the video m-line). `null` until a local
   * description exists.
   */
  readonly mediaEncrypted: MediaEncryptionProfile | null;
}

export function useVideoStream(
  options: UseVideoStreamOptions = {},
): UseVideoStreamState {
  const {
    mediaDevices,
    bandwidth,
    videoEnabled = true,
    ...signalingOptions
  } = options;

  const role = useAppStore(s => s.role);

  const [remoteStream, setRemoteStream] = useState<MediaStreamLike | null>(null);
  const [remoteStreamUrl, setRemoteStreamUrl] = useState<string | null>(null);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [videoController, setVideoController] =
    useState<VideoTrackController | null>(null);
  const [qualityIndex, setQualityIndex] = useState(0);
  const [mediaEncrypted, setMediaEncrypted] =
    useState<MediaEncryptionProfile | null>(null);

  // Baby-unit live state held in refs so cleanup / signals can read it without
  // re-rendering: the captured camera stream, the live peer connection, the
  // published video track + its sender (for pause/resume + bitrate).
  const localStreamRef = useRef<MediaStreamLike | null>(null);
  const peerRef = useRef<PeerConnection | null>(null);
  const senderRef = useRef<RtpSenderLike | null>(null);

  // Stable refs for inputs read inside identity-stable signalling callbacks so a
  // re-render never churns the session.
  const roleRef = useRef(role);
  roleRef.current = role;
  const mediaDevicesRef = useRef(mediaDevices);
  mediaDevicesRef.current = mediaDevices;
  const videoEnabledRef = useRef(videoEnabled);
  videoEnabledRef.current = videoEnabled;
  // The current quality rung, mirrored to a ref so the bandwidth callback can
  // read+advance it without re-subscribing on every step.
  const qualityIndexRef = useRef(qualityIndex);
  qualityIndexRef.current = qualityIndex;

  // baby-unit: capture the camera and publish the video track onto the
  // freshly-created peer connection, BEFORE the answer is negotiated.
  const onPeerConnection = useCallback(async (pc: PeerConnection) => {
    peerRef.current = pc;
    if (roleRef.current !== 'baby') {
      // The parent-unit publishes nothing; it only receives.
      return;
    }
    const capture = await getLocalVideoStream(mediaDevicesRef.current ?? null);
    localStreamRef.current = capture.stream;
    const [videoTrack] = videoTracksOf(capture.stream);
    if (!videoTrack) {
      return;
    }
    const sender = pc.addVideoTrack(videoTrack, capture.stream);
    senderRef.current = sender;

    // Build the REAL sender-backed controller (replaces the DMY-24 no-op) so
    // audio-only mode can pause/resume the outgoing video. Apply the initial
    // enabled state.
    const controller = createSenderVideoTrackController({
      sender,
      track: videoTrack,
    });
    if (!videoEnabledRef.current) {
      controller.disableVideo();
    }
    setVideoController(controller);

    // Apply the starting (top) quality profile to the live sender.
    await setVideoBitrate(sender, VIDEO_QUALITY_LADDER[0]);
  }, []);

  // Surface the DTLS-SRTP encrypted-media assertion the moment the local SDP is
  // created. The SDP itself is never stored or logged; only the coarse profile.
  const onLocalDescription = useCallback((description: { sdp: string }) => {
    setMediaEncrypted(assertEncryptedMediaProfile(description.sdp));
  }, []);

  // parent-unit: attach a real remote video track for rendering.
  const onRemoteTrack = useCallback((event: unknown) => {
    if (roleRef.current === 'baby') {
      return;
    }
    const stream = extractRemoteVideoStream(event as never);
    if (!stream) {
      // Not a video track (or no usable stream): do NOT mark video present.
      return;
    }
    setRemoteStream(stream);
    setRemoteStreamUrl(streamUrlOf(stream));
    setHasRemoteVideo(true);
  }, []);

  const signaling = useSignaling({
    ...signalingOptions,
    onPeerConnection,
    onLocalDescription,
    onRemoteTrack,
  });

  // Reset the encryption assertion when no session is in flight.
  const status = signaling.status;
  useEffect(() => {
    if (status === 'idle') {
      setMediaEncrypted(null);
    }
  }, [status]);

  // --- Adaptive bitrate -----------------------------------------------------
  // Apply a quality rung to the live sender whenever the chosen index changes.
  // setParameters reshapes the encoding in place — no renegotiation, no
  // reconnect (the AC's "without a disconnect").
  useEffect(() => {
    const sender = senderRef.current;
    if (!sender) {
      return;
    }
    // setVideoBitrate is total (it catches its own errors and resolves to a
    // boolean); the trailing catch only keeps the promise from floating.
    setVideoBitrate(sender, VIDEO_QUALITY_LADDER[qualityIndex]).catch(() => {});
  }, [qualityIndex]);

  // React to a bandwidth signal by stepping the quality ladder. Identity-stable
  // so a fresh signal does not re-subscribe.
  const onBandwidthSignal = useCallback((signal: BandwidthSignal) => {
    if (roleRef.current !== 'baby') {
      return;
    }
    if (signal === 'hold') {
      return;
    }
    const direction = signal === 'low' ? 'down' : 'up';
    const next = nextQualityIndex(qualityIndexRef.current, direction);
    if (next !== qualityIndexRef.current) {
      qualityIndexRef.current = next;
      setQualityIndex(next);
    }
  }, []);

  // Subscribe to the bandwidth source on the baby-unit. With no explicit source,
  // derive a coarse signal from the peer connection-state transitions (a
  // zero-dependency proxy). Either way the connection is never recreated.
  const isBaby = role === 'baby';
  useEffect(() => {
    if (!isBaby) {
      return;
    }
    if (bandwidth) {
      return bandwidth.subscribe(onBandwidthSignal);
    }
    // Fallback proxy: map connection-state changes onto a bandwidth signal.
    const pc = peerRef.current;
    if (!pc) {
      return;
    }
    return pc.on('connectionstatechange', state => {
      onBandwidthSignal(bandwidthSignalForState(state));
    });
  }, [isBaby, bandwidth, onBandwidthSignal, signaling.isActive]);

  // Clean up media when an ACTIVE session goes inactive (user stop / failure).
  // Only on a true active→inactive transition — never on the initial inactive
  // mount.
  const isActive = signaling.isActive;
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
      // Stops EVERY track including the video track — releases the camera.
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
    }
    senderRef.current = null;
    peerRef.current = null;
    setVideoController(null);
    setRemoteStream(null);
    setRemoteStreamUrl(null);
    setHasRemoteVideo(false);
    setQualityIndex(0);
  }, [isActive]);

  // Hard safety net on unmount: stop the camera even if the active flag never
  // flipped (e.g. an unmount mid-session). Idempotent — stopStream tolerates a
  // null/already-stopped stream.
  useEffect(() => {
    return () => {
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
      senderRef.current = null;
      peerRef.current = null;
    };
  }, []);

  const quality = useMemo(
    () => VIDEO_QUALITY_LADDER[qualityIndex],
    [qualityIndex],
  );

  return {
    ...signaling,
    remoteStream,
    remoteStreamUrl,
    hasRemoteVideo,
    videoController,
    quality,
    mediaEncrypted,
  };
}
