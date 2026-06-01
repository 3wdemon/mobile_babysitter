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
 * The subset of `MediaStreamTrack` we touch. `kind` lets us distinguish
 * audio/video, `enabled` backs mute/pause, `stop()` releases the underlying
 * capture device (the mic on the baby-unit, or — with the video path, DMY-17 —
 * the camera).
 */
export interface MediaStreamTrackLike {
  /** `'audio'` or `'video'`. */
  readonly kind: string;
  /** Whether the track is currently transmitting. Toggled for mute/pause. */
  enabled: boolean;
  /** Stop the track, releasing the underlying capture device (mic / camera). */
  stop(): void;
}

/**
 * The subset of `MediaStream` we touch: enumerate its tracks (to stop them on
 * cleanup and to detect audio/video), the whole-stream getters, and — for the
 * parent video render path (DMY-17) — react-native-webrtc's `toURL()`, which
 * yields the opaque stream id that {@link RTCView} consumes via `streamURL`.
 */
export interface MediaStreamLike {
  /** All tracks in the stream. */
  getTracks(): MediaStreamTrackLike[];
  /** Just the audio tracks. */
  getAudioTracks?(): MediaStreamTrackLike[];
  /** Just the video tracks (DMY-17). */
  getVideoTracks?(): MediaStreamTrackLike[];
  /**
   * react-native-webrtc's opaque stream URL (its id) used as `RTCView.streamURL`
   * to render the remote video. Present on the native stream; absent on test
   * fakes that do not exercise rendering.
   */
  toURL?(): string;
}

/**
 * Constraints passed to `getUserMedia`. `audio`/`video` may be a plain boolean
 * or — for video (DMY-17) — a {@link VideoConstraints} object requesting a
 * specific resolution / camera.
 */
export interface MediaStreamConstraints {
  readonly audio: boolean | AudioConstraints;
  readonly video: boolean | VideoConstraints;
}

/** Audio capture constraints. Kept open; we use the boolean form today. */
export interface AudioConstraints {
  readonly [key: string]: unknown;
}

/**
 * Video capture constraints (DMY-17). The baby-unit asks for 1080p from the
 * rear camera; react-native-webrtc accepts the `width`/`height`/`frameRate`/
 * `facingMode` shape (plain numbers, no `{ ideal }` wrappers, to match the
 * library's parser). All fields optional so a degraded fallback can request a
 * smaller frame.
 */
export interface VideoConstraints {
  /** Desired frame width in pixels (e.g. 1920 for 1080p). */
  readonly width?: number;
  /** Desired frame height in pixels (e.g. 1080 for 1080p). */
  readonly height?: number;
  /** Desired capture frame-rate. */
  readonly frameRate?: number;
  /** Which camera: `'environment'` (rear, watching the crib) or `'user'`. */
  readonly facingMode?: 'environment' | 'user';
}

/**
 * The slice of react-native-webrtc's `mediaDevices` we use: capture a local
 * stream. Injected so tests supply a fake with no native dependency.
 */
export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
}

/**
 * The subset of an `RTCRtpSender` we touch for the video send-side controls
 * (DMY-17): pausing the outgoing track (`replaceTrack(null)` / restoring it)
 * and shaping the encoding (`getParameters`/`setParameters` for adaptive
 * bitrate). Mirrors react-native-webrtc's `RTCRtpSender` structurally so the
 * logic is unit-testable against a tiny fake.
 */
export interface RtpSenderLike {
  /** The track this sender transmits (`null` once paused). */
  readonly track?: MediaStreamTrackLike | null;
  /** Replace (or clear, with `null`) the outgoing track without renegotiating. */
  replaceTrack(track: MediaStreamTrackLike | null): Promise<void>;
  /** Read the current send parameters (encodings, degradationPreference). */
  getParameters(): RtpSendParametersLike;
  /** Apply modified send parameters (adaptive bitrate). */
  setParameters(parameters: RtpSendParametersLike): Promise<void>;
}

/** The subset of `RTCRtpSendParameters` we mutate for adaptive bitrate. */
export interface RtpSendParametersLike {
  encodings?: RtpEncodingLike[];
  degradationPreference?: string | null;
  readonly [key: string]: unknown;
}

/** A single encoding layer's tunable bitrate/resolution knobs. */
export interface RtpEncodingLike {
  active?: boolean;
  maxBitrate?: number;
  scaleResolutionDownBy?: number;
  maxFramerate?: number;
  readonly [key: string]: unknown;
}

/**
 * The subset of an `RTCRtpTransceiver` we touch (DMY-17): flipping its
 * `direction` between `'sendonly'` and `'inactive'` is the cleanest way to
 * pause/resume the video media line without tearing the connection down.
 */
export interface RtpTransceiverLike {
  /** The media line direction (`'sendonly'`, `'inactive'`, `'recvonly'`, ...). */
  direction: string;
  /** The transceiver's sender (its outgoing track + encoding params). */
  readonly sender?: RtpSenderLike;
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
