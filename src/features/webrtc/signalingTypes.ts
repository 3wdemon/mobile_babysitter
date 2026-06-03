/**
 * WebRTC signalling types (DMY-16).
 *
 * This module defines the FOUNDATION contracts for the P2P signalling layer:
 *  - the wire envelope exchanged between the two phones (offer / answer / ICE),
 *  - the {@link SignalingTransport} abstraction (how those messages travel),
 *  - the {@link PeerConnection} abstraction (a thin, testable wrapper over the
 *    native `RTCPeerConnection`).
 *
 * ## Why two abstractions
 * react-native-webrtc and a real local socket are both NATIVE dependencies that
 * cannot run under Jest. Mirroring the discovery pattern (DMY-7), both are hidden
 * behind small interfaces so the signalling STATE MACHINE — the part that is
 * actually subtle (offer/answer ordering, early-ICE buffering, failure paths) —
 * is fully unit-testable with an in-memory loopback transport and a mock peer
 * connection, while production plugs in the real adapters at the same seams.
 *
 * ## Privacy
 * SDP and ICE candidates describe the device's network topology (local IPs,
 * ports, host candidates). They are NOT user secrets, but they are sensitive
 * network metadata. The logger's redactor already masks the `sdp` and
 * `candidate` keys, so every signalling message logged through it has those
 * fields blanked. We NEVER log a raw SDP/candidate string outside that path.
 */
import type {
  MediaStreamLike,
  MediaStreamTrackLike,
  RtpSenderLike,
} from './mediaTypes';

/**
 * Which side of the signalling handshake this device plays. Derived from the
 * app role:
 *  - `parent` → {@link SignalingRole.initiator}: creates and sends the SDP
 *    offer, then applies the answer. The parent-unit drives the connection
 *    because it is the side that just scanned/selected the baby-unit.
 *  - `baby`   → {@link SignalingRole.responder}: waits for the offer, then
 *    creates and sends the answer.
 *
 * Both sides trickle ICE candidates to each other regardless of role.
 */
export type SignalingRole = 'initiator' | 'responder';

/**
 * Discriminator for a signalling message on the wire. Kept tiny and explicit so
 * a transport implementation can route/validate without understanding SDP.
 */
export type SignalingMessageType = 'offer' | 'answer' | 'ice-candidate' | 'bye';

/**
 * A minimal, transport-agnostic SDP description. Mirrors the shape of
 * `RTCSessionDescriptionInit` (`{ type, sdp }`) without importing the native
 * type, so the envelope is serialisable and testable.
 */
export interface SignalingSdp {
  /** `'offer'` or `'answer'`. */
  readonly type: 'offer' | 'answer';
  /** The SDP blob. Sensitive network metadata — redacted in logs (`sdp` key). */
  readonly sdp: string;
}

/**
 * A minimal, transport-agnostic ICE candidate. Mirrors the JSON shape of
 * `RTCIceCandidateInit`. `candidate === ''` (with a null `sdpMid`) is the
 * end-of-candidates sentinel some stacks emit; consumers tolerate it.
 */
export interface SignalingIceCandidate {
  /** The candidate string. Sensitive — redacted in logs (`candidate` key). */
  readonly candidate: string;
  /** Media stream identification tag, if present. */
  readonly sdpMid?: string | null;
  /** Index of the media description, if present. */
  readonly sdpMLineIndex?: number | null;
}

/**
 * The signalling envelope exchanged over the {@link SignalingTransport}.
 *
 * Carries the ephemeral `sessionId` so a transport shared by/colliding with
 * another session can be rejected, and `from` so a loopback/broadcast transport
 * can ignore its own echoes. A discriminated union keyed on `type`.
 */
export type SignalingMessage =
  | {
      readonly type: 'offer';
      readonly sessionId: string;
      readonly from: SignalingRole;
      readonly description: SignalingSdp;
    }
  | {
      readonly type: 'answer';
      readonly sessionId: string;
      readonly from: SignalingRole;
      readonly description: SignalingSdp;
    }
  | {
      readonly type: 'ice-candidate';
      readonly sessionId: string;
      readonly from: SignalingRole;
      readonly candidate: SignalingIceCandidate;
    }
  | {
      readonly type: 'bye';
      readonly sessionId: string;
      readonly from: SignalingRole;
    };

/**
 * Transport for signalling messages between the two phones (DMY-16).
 *
 * This is the SINGLE integration point for the network transport. The exchange
 * is plain JSON messages; HOW they travel is the transport's concern:
 *  - tests / local development use {@link createLoopbackTransportPair} — an
 *    in-memory pair where one endpoint's `send` delivers to the other's
 *    `onMessage`, with no network at all;
 *  - production wires a real LOCAL socket transport (a WebSocket/TCP listener on
 *    the baby-unit `host:port` surfaced by mDNS discovery, DMY-7) that satisfies
 *    this exact contract. That socket implementation is OUT OF SCOPE for this
 *    issue — see the module README — but the seam is defined here so it slots in
 *    without touching the state machine.
 *
 * Contract:
 *  - `connect()` establishes the channel (resolves when ready; rejects on
 *    failure). For loopback this is immediate.
 *  - `send(message)` enqueues a message for the peer. MUST NOT throw
 *    synchronously for a transient failure — surface it via the channel instead.
 *  - `onMessage(handler)` registers the inbound handler; returns an unsubscribe.
 *  - `onError(handler)` reports a transport-level failure; returns an
 *    unsubscribe. The state machine treats this as a signalling failure.
 *  - `close()` tears the channel down. Idempotent. After close, `send` is a
 *    no-op and no further messages are delivered.
 */
export interface SignalingTransport {
  /** Open the channel. Resolves when ready to send/receive. */
  connect(): Promise<void>;
  /** Send a signalling message to the peer. */
  send(message: SignalingMessage): void;
  /** Subscribe to inbound messages. Returns an unsubscribe function. */
  onMessage(handler: (message: SignalingMessage) => void): () => void;
  /** Subscribe to transport errors. Returns an unsubscribe function. */
  onError(handler: (error: unknown) => void): () => void;
  /** Tear the channel down. Idempotent; safe to call multiple times. */
  close(): void;
}

/**
 * Connection state surfaced by the {@link PeerConnection} wrapper. Mirrors the
 * `RTCPeerConnection.connectionState` values relevant to us. The signalling
 * session maps these onto the store's `ConnectionStatus`.
 */
export type PeerConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

/**
 * Events emitted by the {@link PeerConnection} wrapper. Deliberately a small
 * subset of the native event surface — exactly what the session needs:
 *  - `icecandidate`         — a locally-gathered ICE candidate to send to the
 *    peer (`null` is the end-of-candidates sentinel).
 *  - `connectionstatechange`— the negotiated connection-state changed. This is
 *    what drives `connected` / `failed` — NEVER synthesised by us.
 *  - `track`                — a remote media track arrived (audio/video). The
 *    media-rendering layer (DMY-17) consumes this; the session just forwards it.
 */
export interface PeerConnectionEvents {
  icecandidate: (candidate: SignalingIceCandidate | null) => void;
  connectionstatechange: (state: PeerConnectionState) => void;
  track: (event: unknown) => void;
  /**
   * A remote {@link DataChannel} was opened by the peer (DMY-50). The responder
   * (baby) creates the channel before negotiation; the initiator (parent)
   * receives THIS event when the channel surfaces and uses it to receive alerts.
   * Handed the ready-to-use {@link DataChannel} wrapper.
   */
  datachannel: (channel: DataChannel) => void;
}

/**
 * A minimal, testable wrapper over the native `RTCDataChannel` (DMY-50).
 *
 * The baby-unit opens ONE reliable, ordered data channel on the existing
 * PeerConnection and uses it to push privacy-safe alert events to the parent
 * IN-SESSION — a $0, server-free alternative to APNS/FCM push (DMY-9). The
 * channel carries ONLY small JSON control messages (`{type,timestamp}`); never
 * audio, frames, or any media — that stays on the SRTP media tracks.
 *
 * Honest boundary (vs push): this works only while BOTH apps are live and the
 * PeerConnection is up. A fully evicted/suspended app has no live channel — the
 * data channel is DEAD then. That is by design for the MVP; true wake-from-
 * background delivery would require push (DMY-9) and is out of scope here.
 *
 * The wrapper exposes only `send` / `onMessage` / `onClose` / `readyState` /
 * `close`, normalises the inbound payload to a string, and isolates throwing
 * subscribers — mirroring the {@link PeerConnection} wrapper.
 */
export interface DataChannel {
  /**
   * The channel's negotiated label. A label lets both ends agree on the
   * channel's purpose (e.g. the alert channel) without inspecting payloads.
   */
  readonly label: string;
  /**
   * Send a string payload to the peer. MUST NOT throw for a transient/closed
   * channel — a send on a not-yet-open or closed channel is dropped (logged),
   * never thrown, so the alert pipeline can never crash on a flaky channel.
   * Returns whether the payload was handed to the channel.
   */
  send(payload: string): boolean;
  /** Subscribe to inbound string messages. Returns an unsubscribe function. */
  onMessage(handler: (payload: string) => void): () => void;
  /** Subscribe to the channel closing. Returns an unsubscribe function. */
  onClose(handler: () => void): () => void;
  /** Whether the channel is currently open (ready to send). */
  isOpen(): boolean;
  /** Close the channel and release resources. Idempotent. */
  close(): void;
}

/**
 * Thin, testable wrapper over the native `RTCPeerConnection` (DMY-16).
 *
 * The wrapper exposes ONLY the operations the signalling state machine needs and
 * normalises SDP/ICE to the serialisable {@link SignalingSdp} /
 * {@link SignalingIceCandidate} shapes. Production builds one over
 * react-native-webrtc (see `peerConnection.ts`); tests build a mock that drives
 * the same events.
 *
 * Honest boundary: this wrapper performs the REAL offer/answer/ICE plumbing
 * against whatever `RTCPeerConnection`-like object it is given. It does not — and
 * must not — synthesise a `connected` state; that arrives only from a genuine
 * `connectionstatechange` event.
 */
export interface PeerConnection {
  /** Create an SDP offer and set it as the local description. */
  createOffer(): Promise<SignalingSdp>;
  /** Create an SDP answer and set it as the local description. */
  createAnswer(): Promise<SignalingSdp>;
  /** Apply the peer's SDP as the remote description. */
  setRemoteDescription(description: SignalingSdp): Promise<void>;
  /** Add an ICE candidate received from the peer. */
  addIceCandidate(candidate: SignalingIceCandidate): Promise<void>;
  /**
   * Publish a local media track (baby-unit audio, DMY-18). Adds the track —
   * with its stream — to the connection so it is transmitted to the peer over
   * the encrypted SRTP session. Must be called BEFORE the offer is created so
   * the audio m-line is part of the initial negotiation. No-op-safe if the
   * underlying connection does not support `addTrack`.
   */
  addAudioTrack(track: MediaStreamTrackLike, stream: MediaStreamLike): void;
  /**
   * Publish a local VIDEO track (baby-unit, DMY-17). Adds the track — with its
   * stream — to the connection so it is transmitted to the peer over the
   * encrypted SRTP session, and RETURNS the `RTCRtpSender` for it (or `null` if
   * the underlying connection does not support `addTrack`). The returned sender
   * is the handle the video layer uses to pause/resume (`replaceTrack`) and to
   * shape the encoding (`setParameters`, adaptive bitrate) WITHOUT
   * renegotiating. Must be called BEFORE the local description (offer/answer) is
   * created so the video m-line is part of the initial negotiation. On the
   * baby-unit (the responder, DMY-17) that means before the answer.
   */
  addVideoTrack(
    track: MediaStreamTrackLike,
    stream: MediaStreamLike,
  ): RtpSenderLike | null;
  /**
   * Open a {@link DataChannel} on this connection (DMY-50). Called by the
   * RESPONDER (baby) BEFORE the answer is created so the channel's m-line is
   * part of the negotiation; the initiator (parent) then receives it via the
   * `datachannel` event. Returns the wrapper, or `null` if the underlying
   * connection does not support data channels (a minimal mock) — callers treat
   * a `null` as "alerts-over-datachannel unavailable" and degrade gracefully.
   */
  createDataChannel(label: string): DataChannel | null;
  /** Subscribe to a wrapper event. Returns an unsubscribe function. */
  on<K extends keyof PeerConnectionEvents>(
    event: K,
    handler: PeerConnectionEvents[K],
  ): () => void;
  /** Current connection state. */
  getConnectionState(): PeerConnectionState;
  /**
   * Read a fresh transport stats report (DMY-45). Backs the `getStats`
   * bandwidth source (adaptive bitrate) and the link-quality indicator. Returns
   * an iterable/Map-like of stat entries; resolves to an empty report if the
   * underlying connection does not support `getStats` (a minimal mock).
   */
  getStats(): Promise<unknown>;
  /** Whether a remote description has been applied (gates ICE buffering). */
  hasRemoteDescription(): boolean;
  /** Close the underlying peer connection and release resources. Idempotent. */
  close(): void;
}

/**
 * Factory for a {@link PeerConnection}. Injected into the session so tests can
 * supply a mock without any native dependency. Production passes
 * {@link createPeerConnection} from `peerConnection.ts`.
 */
export type PeerConnectionFactory = (
  config?: PeerConnectionConfig,
) => PeerConnection;

/**
 * ICE configuration for the peer connection.
 *
 * Defaults (`DEFAULT_ICE_SERVERS`) are public Google STUN ONLY — the $0,
 * privacy-first mode (DMY-47). Rationale:
 *  - Host candidates cover same-Wi-Fi P2P; STUN adds the server-reflexive
 *    (public) address so most home NATs traverse without any paid infrastructure.
 *  - STUN never relays media — the two phones still talk peer-to-peer — so no
 *    third party ever sees the stream. This is why STUN, unlike TURN, fits the
 *    privacy stance.
 *  - The case STUN cannot solve is SYMMETRIC NAT on both ends: ICE may then never
 *    reach `connected`. Rather than hang silently, the signalling layer arms a
 *    timeout (DMY-47) and surfaces user guidance ("check Wi-Fi / restart").
 *  - TURN relay — the paid option that also defeats symmetric NAT — is DMY-19 and
 *    is deliberately NOT configured here. No TURN credentials live in this code.
 *
 * `iceServers` is overridable so a future TURN-enabled build (DMY-19) or a test
 * can inject its own list.
 */
export interface PeerConnectionConfig {
  /**
   * ICE servers (STUN/TURN). Defaults to public Google STUN only — see
   * {@link DEFAULT_ICE_SERVERS}. No TURN here (DMY-19).
   */
  readonly iceServers?: readonly RtcIceServer[];
}

/** A single ICE server entry (subset of the WebRTC `RTCIceServer`). */
export interface RtcIceServer {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
}
