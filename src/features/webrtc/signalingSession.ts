/**
 * signalingSession — the WebRTC signalling state machine (DMY-16).
 *
 * Orchestrates a single P2P handshake between the two phones, given:
 *   - a {@link PeerConnection} (the wrapper over `RTCPeerConnection`), and
 *   - a {@link SignalingTransport} (loopback in tests, a real local socket in
 *     production).
 *
 * ## Roles
 *  - `initiator` (parent): on `start`, creates an SDP offer, sends it, and waits
 *    for the answer (which it applies as the remote description).
 *  - `responder` (baby): on receiving the offer, applies it, creates an answer,
 *    and sends it back.
 * Both sides trickle their locally-gathered ICE candidates over the transport
 * and apply the peer's candidates.
 *
 * ## Early-ICE buffering
 * A peer may send ICE candidates BEFORE its SDP has been applied (the remote
 * description is not set yet). Adding a candidate before the remote description
 * exists throws on most stacks, so such candidates are BUFFERED and flushed the
 * instant the remote description is applied. This is essential for a reliable
 * handshake and is fully covered by tests.
 *
 * ## Honest connection state
 * The session NEVER fabricates a `connected` outcome. `onStatusChange` is driven
 * exclusively by real `connectionstatechange` events from the peer connection
 * (mocked in tests). A failure (`failed`/`closed` peer state, a thrown
 * negotiation step, or a transport error) maps to `failed`.
 *
 * ## Privacy
 * The session logs only coarse, non-PII facts. SDP/ICE never reach the logger as
 * raw strings; on the rare diagnostic that includes them, the redactor masks the
 * `sdp`/`candidate` keys.
 */
import { logger } from '../../services/logger';
import {
  createPeerConnection as defaultCreatePeerConnection,
} from './peerConnection';
import type {
  PeerConnection,
  PeerConnectionConfig,
  PeerConnectionFactory,
  PeerConnectionState,
  SignalingIceCandidate,
  SignalingMessage,
  SignalingRole,
  SignalingSdp,
  SignalingTransport,
} from './signalingTypes';

/**
 * High-level session status reported to the caller. Maps onto the store's
 * `ConnectionStatus` but is kept independent so the session has no store
 * dependency (the hook does the mapping).
 */
export type SignalingSessionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

/** Options for {@link SignalingSession}. */
export interface SignalingSessionOptions {
  /** This device's signalling role (parent → initiator, baby → responder). */
  readonly role: SignalingRole;
  /** Ephemeral pairing session id; stamped onto and validated against messages. */
  readonly sessionId: string;
  /** The transport to exchange messages over (loopback in tests). */
  readonly transport: SignalingTransport;
  /**
   * Factory for the peer connection. Defaults to the real
   * react-native-webrtc-backed one; tests inject a mock.
   */
  readonly createPeerConnection?: PeerConnectionFactory;
  /** ICE configuration forwarded to the peer connection. */
  readonly peerConfig?: PeerConnectionConfig;
  /** Called whenever the high-level session status changes. */
  readonly onStatusChange?: (status: SignalingSessionStatus) => void;
  /** Called when a remote media track arrives (for the media layer, DMY-17). */
  readonly onRemoteTrack?: (event: unknown) => void;
}

/** Map a {@link PeerConnectionState} onto the session status. */
function mapPeerState(state: PeerConnectionState): SignalingSessionStatus {
  switch (state) {
    case 'connecting':
      return 'connecting';
    case 'connected':
      return 'connected';
    case 'disconnected':
      return 'disconnected';
    case 'failed':
    case 'closed':
      return 'failed';
    case 'new':
    default:
      return 'connecting';
  }
}

/**
 * A single signalling handshake. One instance per pairing attempt. Call
 * {@link start} once; call {@link stop} to tear everything down (idempotent).
 */
export class SignalingSession {
  private readonly role: SignalingRole;
  private readonly sessionId: string;
  private readonly transport: SignalingTransport;
  private readonly factory: PeerConnectionFactory;
  private readonly peerConfig?: PeerConnectionConfig;
  private readonly onStatusChange?: (status: SignalingSessionStatus) => void;
  private readonly onRemoteTrack?: (event: unknown) => void;

  private pc: PeerConnection | null = null;
  private status: SignalingSessionStatus = 'idle';
  private started = false;
  private stopped = false;

  /**
   * ICE candidates received from the peer BEFORE the remote description was
   * applied. Flushed (and cleared) once the remote description is set.
   */
  private readonly pendingRemoteIce: SignalingIceCandidate[] = [];

  private readonly unsubscribes: Array<() => void> = [];

  constructor(options: SignalingSessionOptions) {
    this.role = options.role;
    this.sessionId = options.sessionId;
    this.transport = options.transport;
    this.factory = options.createPeerConnection ?? defaultCreatePeerConnection;
    this.peerConfig = options.peerConfig;
    this.onStatusChange = options.onStatusChange;
    this.onRemoteTrack = options.onRemoteTrack;
  }

  /** Current high-level status. */
  getStatus(): SignalingSessionStatus {
    return this.status;
  }

  private setStatus(next: SignalingSessionStatus): void {
    if (next === this.status) {
      return;
    }
    this.status = next;
    logger.info('webrtc/signaling: status', { status: next });
    try {
      this.onStatusChange?.(next);
    } catch {
      // A status subscriber must never break the session.
    }
  }

  /**
   * Begin the handshake. Idempotent (a second call is a no-op). On any setup
   * failure the session transitions to `failed` and does NOT throw — callers
   * observe failure via `onStatusChange`.
   */
  async start(): Promise<void> {
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    this.setStatus('connecting');

    try {
      const pc = this.factory(this.peerConfig);
      this.pc = pc;
      this.wirePeerConnection(pc);
      this.wireTransport();

      await this.transport.connect();

      // Initiator drives: create + send the offer immediately. The responder
      // waits for the inbound offer (handled in onMessage).
      if (this.role === 'initiator') {
        const offer = await pc.createOffer();
        this.send({
          type: 'offer',
          sessionId: this.sessionId,
          from: 'initiator',
          description: offer,
        });
      }
    } catch (error) {
      logger.error('webrtc/signaling: start failed', error);
      this.fail();
    }
  }

  private wirePeerConnection(pc: PeerConnection): void {
    this.unsubscribes.push(
      pc.on('connectionstatechange', state => {
        const mapped = mapPeerState(state);
        if (mapped === 'failed') {
          // A genuine peer-connection failure (failed/closed): surface `failed`
          // AND tear the session down so we don't leak the peer connection /
          // transport. This is the real-event failure path (not fabricated).
          this.fail();
          return;
        }
        this.setStatus(mapped);
      }),
    );

    this.unsubscribes.push(
      pc.on('icecandidate', candidate => {
        if (!candidate) {
          // End-of-candidates sentinel; nothing to send.
          return;
        }
        this.send({
          type: 'ice-candidate',
          sessionId: this.sessionId,
          from: this.role,
          candidate,
        });
      }),
    );

    this.unsubscribes.push(
      pc.on('track', event => {
        try {
          this.onRemoteTrack?.(event);
        } catch {
          // A track subscriber must never break the session.
        }
      }),
    );
  }

  private wireTransport(): void {
    this.unsubscribes.push(
      this.transport.onMessage(message => {
        // handleMessage is total (own try/catch → maps errors to `failed`); the
        // .catch only keeps the promise from floating for the linter.
        this.handleMessage(message).catch(() => {});
      }),
    );
    this.unsubscribes.push(
      this.transport.onError(error => {
        logger.error('webrtc/signaling: transport error', error);
        this.fail();
      }),
    );
  }

  private async handleMessage(message: SignalingMessage): Promise<void> {
    if (this.stopped || !this.pc) {
      return;
    }
    // Ignore messages for a different session, and our own echoes (a broadcast
    // transport may loop a message back to its sender).
    if (message.sessionId !== this.sessionId || message.from === this.role) {
      return;
    }

    try {
      switch (message.type) {
        case 'offer':
          await this.handleOffer(message.description);
          break;
        case 'answer':
          await this.handleAnswer(message.description);
          break;
        case 'ice-candidate':
          await this.handleRemoteIce(message.candidate);
          break;
        case 'bye':
          logger.info('webrtc/signaling: peer said bye');
          this.setStatus('disconnected');
          break;
      }
    } catch (error) {
      logger.error('webrtc/signaling: message handling failed', error);
      this.fail();
    }
  }

  private async handleOffer(description: SignalingSdp): Promise<void> {
    const pc = this.pc;
    if (!pc) {
      return;
    }
    // Only the responder should receive an offer; an initiator ignores it
    // (glare handling beyond this is out of scope for the MVP handshake).
    if (this.role !== 'responder') {
      logger.warn('webrtc/signaling: initiator ignoring unexpected offer');
      return;
    }
    await pc.setRemoteDescription(description);
    await this.flushPendingIce();
    const answer = await pc.createAnswer();
    this.send({
      type: 'answer',
      sessionId: this.sessionId,
      from: 'responder',
      description: answer,
    });
  }

  private async handleAnswer(description: SignalingSdp): Promise<void> {
    const pc = this.pc;
    if (!pc) {
      return;
    }
    if (this.role !== 'initiator') {
      logger.warn('webrtc/signaling: responder ignoring unexpected answer');
      return;
    }
    await pc.setRemoteDescription(description);
    await this.flushPendingIce();
  }

  private async handleRemoteIce(
    candidate: SignalingIceCandidate,
  ): Promise<void> {
    const pc = this.pc;
    if (!pc) {
      return;
    }
    // Buffer candidates that arrive before the remote description is applied:
    // adding them now would throw on most WebRTC stacks. They are flushed in
    // order the moment the remote description lands.
    if (!pc.hasRemoteDescription()) {
      this.pendingRemoteIce.push(candidate);
      logger.debug('webrtc/signaling: buffered early ICE candidate');
      return;
    }
    await pc.addIceCandidate(candidate);
  }

  private async flushPendingIce(): Promise<void> {
    const pc = this.pc;
    if (!pc || this.pendingRemoteIce.length === 0) {
      return;
    }
    const buffered = this.pendingRemoteIce.splice(0);
    logger.debug('webrtc/signaling: flushing buffered ICE candidates', {
      count: buffered.length,
    });
    for (const candidate of buffered) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // One bad candidate must not abort the rest of the flush.
        logger.warn('webrtc/signaling: failed to add buffered ICE candidate');
      }
    }
  }

  private send(message: SignalingMessage): void {
    if (this.stopped) {
      return;
    }
    try {
      this.transport.send(message);
    } catch (error) {
      logger.error('webrtc/signaling: send failed', error);
      this.fail();
    }
  }

  /** Transition to `failed` and tear down. */
  private fail(): void {
    this.setStatus('failed');
    this.teardown();
  }

  /**
   * Stop the session: send a `bye`, close the peer connection and the transport,
   * unsubscribe everything. Idempotent. Used on user-initiated stop and on
   * unmount.
   */
  stop(): void {
    if (this.stopped) {
      return;
    }
    // Best-effort polite hangup before we tear the transport down.
    if (this.started) {
      try {
        this.transport.send({
          type: 'bye',
          sessionId: this.sessionId,
          from: this.role,
        });
      } catch {
        // ignore — we are shutting down anyway.
      }
    }
    this.teardown();
  }

  private teardown(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;

    for (const unsub of this.unsubscribes.splice(0)) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    this.pendingRemoteIce.splice(0);

    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        logger.warn('webrtc/signaling: error closing peer connection');
      }
      this.pc = null;
    }
    try {
      this.transport.close();
    } catch {
      logger.warn('webrtc/signaling: error closing transport');
    }
    logger.info('webrtc/signaling: session stopped');
  }
}

/** Convenience factory mirroring the project's service-style constructors. */
export function createSignalingSession(
  options: SignalingSessionOptions,
): SignalingSession {
  return new SignalingSession(options);
}
