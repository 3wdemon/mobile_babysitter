/**
 * useAudioStream — drive the one-way baby→parent audio path (DMY-18).
 *
 * Wraps {@link useSignaling} and owns the MEDIA lifecycle on top of the
 * signalling handshake, branching on the device `role`:
 *
 *  - **baby-unit (responder):** when the peer connection is created (before the
 *    answer is negotiated), captures the microphone via
 *    `getUserMedia({ audio: true, video: false })` — audio only, the camera is
 *    never powered up — and publishes the audio track onto the connection so it
 *    is sent to the parent over the encrypted SRTP session. The local stream is
 *    stopped (mic released) on stop/unmount.
 *
 *  - **parent-unit (initiator):** on a real `ontrack` event carrying audio,
 *    extracts the remote `MediaStream` and hands it to the {@link AudioPlayback}
 *    controller (`playing` flips true). `playing` is driven ONLY by a genuine
 *    remote-track arrival — never fabricated.
 *
 * ## Encryption (DTLS-SRTP)
 * WebRTC media is encrypted by construction (DTLS key exchange + SRTP); there is
 * no API to send it in the clear. After negotiation the hook inspects the local
 * SDP via {@link assertEncryptedMediaProfile} and exposes `mediaEncrypted` so a
 * runtime diagnostic / test can confirm the media profile is SRTP, not
 * plaintext. We do not "enable" encryption — we just never opt out (we cannot).
 *
 * ## Honest boundaries
 *  - Real microphone capture runs against the injected `mediaDevices` (the real
 *    react-native-webrtc one in production; a fake in tests). No stream is faked.
 *  - Audio ROUTING (loud speaker, background VoIP session, earpiece/proximity)
 *    is the {@link AudioPlayback} controller's job and lands with the in-call /
 *    VoIP work (DMY-9). The shipped default is a safe no-op; in a real build
 *    react-native-webrtc still plays a live remote track on the default output.
 *  - Transport injection follows {@link useSignaling}: with no transport the
 *    hook stays inert (no capture, no session) — it never fabricates a stream.
 *
 * ## Privacy
 * No audio content, stream/track ids, or SDP is ever logged — only coarse
 * lifecycle facts through the redacting logger.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppStore } from '../../store/useAppStore';
import {
  assertEncryptedMediaProfile,
  extractRemoteAudioStream,
  getLocalAudioStream,
  setStreamAudioEnabled,
  stopStream,
} from './audioStream';
import { createSafeAudioPlayback } from './audioPlayback';
import { useSignaling } from './useSignaling';
import type { AudioPlayback } from './audioPlayback';
import type { MediaDevicesLike, MediaEncryptionProfile } from './mediaTypes';
import type { PeerConnection } from './signalingTypes';
import type { UseSignalingOptions, UseSignalingState } from './useSignaling';

/** Options for {@link useAudioStream}. */
export interface UseAudioStreamOptions
  extends Omit<UseSignalingOptions, 'onPeerConnection' | 'onRemoteTrack'> {
  /**
   * Media-devices source for baby-unit capture. Omit to use the real
   * react-native-webrtc `mediaDevices`; tests inject a fake. Ignored on the
   * parent-unit (which captures nothing).
   */
  readonly mediaDevices?: MediaDevicesLike;
  /**
   * Audio playback / routing controller for the parent-unit. Omit for the safe
   * no-op (until DMY-9 wires real routing). Ignored on the baby-unit.
   */
  readonly playback?: AudioPlayback;
  /** Start muted on the parent-unit. Defaults to `false`. */
  readonly initiallyMuted?: boolean;
}

/** Value returned by {@link useAudioStream}. */
export interface UseAudioStreamState extends UseSignalingState {
  /**
   * Parent-unit: whether a remote audio stream has arrived and been handed to
   * playback. True ONLY after a real `ontrack` — never fabricated.
   */
  readonly hasRemoteAudio: boolean;
  /** Parent-unit: whether playback is currently active (and not stopped). */
  readonly playing: boolean;
  /** Parent-unit: whether playback is muted. */
  readonly muted: boolean;
  /** Parent-unit: toggle playback mute. No-op on the baby-unit. */
  readonly setMuted: (muted: boolean) => void;
  /**
   * The negotiated media security profile (DTLS-SRTP), derived from the local
   * SDP after negotiation. `null` until a local description exists.
   */
  readonly mediaEncrypted: MediaEncryptionProfile | null;
}

export function useAudioStream(
  options: UseAudioStreamOptions = {},
): UseAudioStreamState {
  const {
    mediaDevices,
    playback,
    initiallyMuted = false,
    ...signalingOptions
  } = options;

  const role = useAppStore(s => s.role);

  const [hasRemoteAudio, setHasRemoteAudio] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMutedState] = useState(initiallyMuted);
  const [mediaEncrypted, setMediaEncrypted] =
    useState<MediaEncryptionProfile | null>(null);

  // The baby-unit's captured local stream and the live peer connection — held in
  // refs so cleanup can stop the mic / read the SDP without re-rendering.
  const localStreamRef = useRef<Awaited<
    ReturnType<typeof getLocalAudioStream>
  > | null>(null);
  const peerRef = useRef<PeerConnection | null>(null);

  // One wrapped playback controller per (lifetime × controller identity).
  const safePlayback = useMemo(
    () => createSafeAudioPlayback(playback),
    [playback],
  );

  // Stable refs for inputs read inside the (identity-stable) signalling
  // callbacks so a re-render never churns the session.
  const roleRef = useRef(role);
  roleRef.current = role;
  const mediaDevicesRef = useRef(mediaDevices);
  mediaDevicesRef.current = mediaDevices;
  const playbackRef = useRef(safePlayback);
  playbackRef.current = safePlayback;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // baby-unit: capture + publish audio onto the freshly-created peer connection,
  // BEFORE the answer is negotiated. Awaited inside the session.
  const onPeerConnection = useCallback(async (pc: PeerConnection) => {
    peerRef.current = pc;
    if (roleRef.current !== 'baby') {
      // The parent-unit publishes nothing; it only receives.
      return;
    }
    const stream = await getLocalAudioStream(mediaDevicesRef.current ?? null);
    localStreamRef.current = stream;
    for (const track of stream.getTracks()) {
      if (track.kind === 'audio') {
        pc.addAudioTrack(track, stream);
      }
    }
  }, []);

  // Surface the DTLS-SRTP encrypted-media assertion the moment the local SDP is
  // created (offer for the parent, answer for the baby). Event-driven — no
  // polling. The SDP itself is never stored or logged; only the coarse profile.
  const onLocalDescription = useCallback((description: { sdp: string }) => {
    setMediaEncrypted(assertEncryptedMediaProfile(description.sdp));
  }, []);

  // parent-unit: attach a real remote audio track to playback.
  const onRemoteTrack = useCallback((event: unknown) => {
    if (roleRef.current === 'baby') {
      return;
    }
    const stream = extractRemoteAudioStream(event as never);
    if (!stream) {
      // Not an audio track (or no usable stream): do NOT mark playing.
      return;
    }
    setStreamAudioEnabled(stream, !mutedRef.current);
    playbackRef.current.start(stream);
    setHasRemoteAudio(true);
    setPlaying(true);
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

  // Mute toggle: flip playback mute and the remote stream's track enabled flag.
  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    playbackRef.current.setMuted(next);
  }, []);

  // Clean up media when an ACTIVE session goes inactive (user stop / failure).
  // We only release media on a true active→inactive transition — never on the
  // initial inactive mount (which would null `peerRef` before start() sets it).
  const isActive = signaling.isActive;
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (isActive) {
      wasActiveRef.current = true;
      return;
    }
    if (!wasActiveRef.current) {
      // Never started: nothing to release, and must NOT touch peerRef.
      return;
    }
    wasActiveRef.current = false;
    if (localStreamRef.current) {
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
    }
    if (playing) {
      safePlayback.stop();
      setPlaying(false);
      setHasRemoteAudio(false);
    }
    peerRef.current = null;
  }, [isActive, playing, safePlayback]);

  // Hard safety net on unmount: stop the mic and playback even if the active
  // flag never flipped (e.g. an unmount mid-session).
  useEffect(() => {
    return () => {
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
      safePlayback.stop();
      peerRef.current = null;
    };
  }, [safePlayback]);

  return {
    ...signaling,
    hasRemoteAudio,
    playing,
    muted,
    setMuted,
    mediaEncrypted,
  };
}
