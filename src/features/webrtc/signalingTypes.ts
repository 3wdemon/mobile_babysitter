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
   * renegotiating. Must be called BEFORE the offer is created so the video
   * m-line is part of the initial negotiation.
   */
  addVideoTrack(
    track: MediaStreamTrackLike,
    stream: MediaStreamLike,
  ): RtpSenderLike | null;
  /** Subscribe to a wrapper event. Returns an unsubscribe function. */
  on<K extends keyof PeerConnectionEvents>(
    event: K,
    handler: PeerConnectionEvents[K],
  ): () => void;
  /** Current connection state. */
  getConnectionState(): PeerConnectionState;
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
 * For local P2P on the same Wi-Fi the host candidates are enough, so the default
 * `iceServers` is EMPTY. A public STUN placeholder can be enabled for the
 * local-network-with-NAT case, but TURN relay (for the cellular/internet
 * fallback) is explicitly OUT OF SCOPE here — that is DMY-19. We do not add any
 * TURN credentials in this issue.
 */
export interface PeerConnectionConfig {
  /** ICE servers (STUN/TURN). Defaults to none — see {@link DEFAULT_ICE_SERVERS}. */
  readonly iceServers?: readonly RtcIceServer[];
}

/** A single ICE server entry (subset of the WebRTC `RTCIceServer`). */
export interface RtcIceServer {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
}
