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
 * ## Two-way talk (push-to-talk, DMY-20)
 * When `enableTalkback` is set, the path becomes bidirectional:
 *  - the **parent** also captures its OWN microphone (with native echo
 *    cancellation, {@link TALK_AUDIO_CONSTRAINTS}) and publishes it onto the
 *    same peer connection, but the track is kept DISABLED by default —
 *    push-to-talk. `startTalking()` enables it (voice flows to the baby);
 *    `stopTalking()` disables it again. Half-duplex by construction.
 *  - the **baby** plays the parent's incoming audio through the same
 *    {@link AudioPlayback} controller, so the parent's voice comes out of the
 *    baby-unit's speaker. `playing` on the baby reflects a REAL parent track.
 * Echo cancellation is the native WebRTC AEC requested via the talk constraints;
 * half-duplex push-to-talk (the parent mic is open only while talking) is the
 * additional structural guard against feedback. See `talkback.ts`.
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
import { createTalkbackController, getTalkbackAudioStream } from './talkback';
import { useSignaling } from './useSignaling';
import type { AudioPlayback } from './audioPlayback';
import type { MediaDevicesLike, MediaEncryptionProfile } from './mediaTypes';
import type { PeerConnection } from './signalingTypes';
import type { TalkbackController } from './talkback';
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
  /**
   * Enable two-way talk (parent→baby push-to-talk, DMY-20). When set, the
   * parent also captures its microphone (with native echo cancellation) and
   * publishes a DISABLED talk track onto the same peer connection; the baby
   * plays the parent's incoming audio. Defaults to `false` (one-way audio).
   */
  readonly enableTalkback?: boolean;
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
  /**
   * Two-way talk (DMY-20). Whether the talkback feature is enabled for this
   * session. When false, `talking` stays false and the talk controls are no-ops.
   */
  readonly talkbackEnabled: boolean;
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

export function useAudioStream(
  options: UseAudioStreamOptions = {},
): UseAudioStreamState {
  const {
    mediaDevices,
    playback,
    initiallyMuted = false,
    enableTalkback = false,
    ...signalingOptions
  } = options;

  const role = useAppStore(s => s.role);

  const [hasRemoteAudio, setHasRemoteAudio] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMutedState] = useState(initiallyMuted);
  const [mediaEncrypted, setMediaEncrypted] =
    useState<MediaEncryptionProfile | null>(null);
  const [talking, setTalking] = useState(false);

  // The baby-unit's captured local stream and the live peer connection — held in
  // refs so cleanup can stop the mic / read the SDP without re-rendering.
  const localStreamRef = useRef<Awaited<
    ReturnType<typeof getLocalAudioStream>
  > | null>(null);
  const peerRef = useRef<PeerConnection | null>(null);
  // The parent's push-to-talk controller (DMY-20) — null until the talk capture
  // is acquired. Held in a ref so press-in/press-out and cleanup reach the real
  // track without re-rendering.
  const talkbackRef = useRef<TalkbackController | null>(null);

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
  const enableTalkbackRef = useRef(enableTalkback);
  enableTalkbackRef.current = enableTalkback;

  // baby-unit: capture + publish audio onto the freshly-created peer connection,
  // BEFORE the answer is negotiated. parent-unit: when talkback is on, also
  // capture its OWN mic (echo-cancelled) and publish a DISABLED push-to-talk
  // track. Awaited inside the session so capture completes before negotiation.
  const onPeerConnection = useCallback(async (pc: PeerConnection) => {
    peerRef.current = pc;
    if (roleRef.current === 'baby') {
      const stream = await getLocalAudioStream(mediaDevicesRef.current ?? null);
      localStreamRef.current = stream;
      for (const track of stream.getTracks()) {
        if (track.kind === 'audio') {
          pc.addAudioTrack(track, stream);
        }
      }
      return;
    }
    // parent-unit: publishes nothing unless two-way talk is enabled.
    if (!enableTalkbackRef.current) {
      return;
    }
    // Capture the parent mic with native echo cancellation and publish a
    // push-to-talk track that is DISABLED by default (half-duplex; nothing is
    // transmitted until the parent holds the talk button).
    const talkStream = await getTalkbackAudioStream(
      mediaDevicesRef.current ?? null,
    );
    const controller = createTalkbackController(talkStream, next =>
      setTalking(next),
    );
    talkbackRef.current = controller;
    for (const track of talkStream.getTracks()) {
      if (track.kind === 'audio') {
        // The track is already disabled by the controller; we still add it so
        // the parent→baby audio m-line is part of the initial negotiation.
        pc.addAudioTrack(track, talkStream);
      }
    }
  }, []);

  // Surface the DTLS-SRTP encrypted-media assertion the moment the local SDP is
  // created (offer for the parent, answer for the baby). Event-driven — no
  // polling. The SDP itself is never stored or logged; only the coarse profile.
  const onLocalDescription = useCallback((description: { sdp: string }) => {
    setMediaEncrypted(assertEncryptedMediaProfile(description.sdp));
  }, []);

  // Attach a real remote audio track to playback. On the parent this is the
  // baby→parent monitor audio (DMY-18); on the baby — only with two-way talk
  // enabled — this is the parent's push-to-talk voice (DMY-20). The baby never
  // mutes the incoming talk (the parent already controls it via push-to-talk).
  const onRemoteTrack = useCallback((event: unknown) => {
    if (roleRef.current === 'baby' && !enableTalkbackRef.current) {
      // One-way audio: the baby publishes only and ignores any stray track.
      return;
    }
    const stream = extractRemoteAudioStream(event as never);
    if (!stream) {
      // Not an audio track (or no usable stream): do NOT mark playing.
      return;
    }
    if (roleRef.current !== 'baby') {
      // Parent honours its playback mute on the monitor audio.
      setStreamAudioEnabled(stream, !mutedRef.current);
    }
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

  // Push-to-talk (DMY-20): enable/disable the parent's outgoing talk track. Both
  // are no-ops until the talk capture is ready (controller acquired) — they
  // NEVER fabricate a talking state; `talking` is driven by the real track flag.
  const startTalking = useCallback(() => {
    talkbackRef.current?.startTalking();
  }, []);
  const stopTalking = useCallback(() => {
    talkbackRef.current?.stopTalking();
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
    if (talkbackRef.current) {
      // Release the parent talk mic (stops the track) — no capture leak.
      talkbackRef.current.dispose();
      talkbackRef.current = null;
      setTalking(false);
    }
    if (playing) {
      safePlayback.stop();
      setPlaying(false);
      setHasRemoteAudio(false);
    }
    peerRef.current = null;
  }, [isActive, playing, safePlayback]);

  // Hard safety net: stop the mic / talk capture and playback on TRUE unmount
  // even if the active flag never flipped (e.g. an unmount mid-session). Keyed
  // on nothing so it runs only on unmount — never when the (possibly inline)
  // playback prop identity changes, which must NOT tear down a live capture.
  useEffect(() => {
    return () => {
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
      talkbackRef.current?.dispose();
      talkbackRef.current = null;
      playbackRef.current.stop();
      peerRef.current = null;
    };
  }, []);

  return {
    ...signaling,
    hasRemoteAudio,
    playing,
    muted,
    setMuted,
    mediaEncrypted,
    talkbackEnabled: enableTalkback,
    talking,
    startTalking,
    stopTalking,
  };
}
