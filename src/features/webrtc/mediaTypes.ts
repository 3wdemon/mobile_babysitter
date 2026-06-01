/**
 * Minimal structural media types for the audio stream layer (DMY-18).
 *
 * react-native-webrtc's `MediaStream` / `MediaStreamTrack` / `RTCRtpTransceiver`
 * are NATIVE objects that cannot run under Jest. Mirroring the signalling
 * pattern (DMY-16), we depend only on the small structural shapes we actually
 * use, so the audio logic is fully unit-testable against tiny mocks while
 * production plugs in the real native objects at the same seams.
 *
 * ## Encryption (DTLS-SRTP) — note, not a knob
 * WebRTC media is ALWAYS encrypted: every `RTCPeerConnection` negotiates DTLS
 * for key exchange and carries RTP over SRTP. There is no API to send media in
 * the clear — plaintext RTP/AVP is rejected during SDP negotiation (the only
 * accepted profiles are `UDP/TLS/RTP/SAVPF` / `RTP/SAVPF`). So this layer does
 * not "add" encryption; it must simply NOT do anything that would disable it
 * (which is impossible via the public API anyway) and surfaces a coarse
 * assertion hook (see {@link MediaEncryptionProfile}) for tests/diagnostics.
 */

/**
 * The subset of `MediaStreamTrack` we touch. `kind` lets us assert audio-only
 * (no video), `enabled` backs mute/unmute, `stop()` releases the mic.
 */
export interface MediaStreamTrackLike {
  /** `'audio'` or `'video'`. We only ever publish/expect `'audio'` here. */
  readonly kind: string;
  /** Whether the track is currently transmitting. Toggled for mute/unmute. */
  enabled: boolean;
  /** Stop the track, releasing the underlying capture device (the mic). */
  stop(): void;
}

/**
 * The subset of `MediaStream` we touch: enumerate its tracks (to stop them on
 * cleanup and to detect audio) and the whole-stream getters.
 */
export interface MediaStreamLike {
  /** All tracks in the stream. */
  getTracks(): MediaStreamTrackLike[];
  /** Just the audio tracks. */
  getAudioTracks?(): MediaStreamTrackLike[];
}

/**
 * Constraints passed to `getUserMedia`. We always request audio and explicitly
 * DISABLE video on the baby-unit: this issue ships audio→parent only; the mic
 * is the sole capture device and the camera must not be powered up.
 */
export interface MediaStreamConstraints {
  readonly audio: boolean;
  readonly video: boolean;
}

/**
 * The slice of react-native-webrtc's `mediaDevices` we use: capture a local
 * stream. Injected so tests supply a fake with no native dependency.
 */
export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
}

/**
 * A remote-track event as delivered by `RTCPeerConnection.ontrack`. We read the
 * receiver's `track` and the associated `streams[0]`. Both shapes appear across
 * platforms, so consumers tolerate either.
 */
export interface TrackEventLike {
  readonly track?: MediaStreamTrackLike;
  readonly streams?: ReadonlyArray<MediaStreamLike>;
  readonly receiver?: { readonly track?: MediaStreamTrackLike };
}

/**
 * Coarse, non-PII description of the negotiated media security profile, surfaced
 * by the peer-connection wrapper so a test/diagnostic can ASSERT that media is
 * carried over an encrypted (DTLS-SRTP) profile and never plaintext RTP.
 *
 * This is derived from the local/remote SDP `m=` line profile token:
 *  - `UDP/TLS/RTP/SAVPF` / `RTP/SAVPF` / `*SAVP*` → encrypted (SRTP).
 *  - `RTP/AVP` / `RTP/AVPF` (no `S`) → plaintext — which WebRTC will NOT
 *    negotiate; if we ever saw it we would treat the media as insecure.
 */
export interface MediaEncryptionProfile {
  /** Whether the negotiated media profile is the encrypted SRTP one. */
  readonly encrypted: boolean;
  /** The raw profile token(s) observed (e.g. `'UDP/TLS/RTP/SAVPF'`). Diagnostic. */
  readonly profiles: readonly string[];
}
