/**
 * signalingTransport — the transport seam for signalling messages (DMY-16).
 *
 * The signalling state machine speaks plain JSON {@link SignalingMessage}s; HOW
 * they travel between the two phones is hidden behind {@link SignalingTransport}.
 * This module provides:
 *   - {@link createLoopbackTransportPair} — an in-memory pair of endpoints used
 *     by tests and local development. One endpoint's `send` is delivered to the
 *     other's `onMessage` (asynchronously, like a real channel), with no network
 *     at all. This is what lets the full initiator↔responder handshake be
 *     exercised under Jest.
 *   - {@link createLocalSocketTransport} — the INTEGRATION POINT for the real
 *     local socket transport. It is intentionally a stub in this issue (it
 *     throws): wiring a real WebSocket/TCP listener on the baby-unit's
 *     mDNS-advertised `host:port` (DMY-7) is a follow-up. The seam is defined so
 *     it can be swapped in without touching the state machine.
 *
 * ## Honest scope
 * Only the loopback transport is functional in this issue. End-to-end signalling
 * between two physical devices requires the real socket transport AND two
 * devices on a network — that is a manual / follow-up milestone, not something
 * this issue can verify in CI.
 *
 * ## Privacy
 * The transport carries SDP/ICE (sensitive network metadata). It performs NO
 * logging of message bodies; any diagnostic goes through the redacting logger
 * (which masks `sdp`/`candidate`). The loopback transport keeps everything
 * in-process — nothing touches the wire.
 */
import { logger } from '../../services/logger';
import type { SignalingMessage, SignalingTransport } from './signalingTypes';

/** A loopback endpoint plus a hook to inject the peer it delivers to. */
interface LoopbackEndpoint extends SignalingTransport {
  /** @internal Wire this endpoint to deliver `send`s into `peer`'s inbox. */
  __setPeer(peer: LoopbackEndpoint): void;
  /** @internal Deliver a message into THIS endpoint's inbound handlers. */
  __deliver(message: SignalingMessage): void;
}

function createLoopbackEndpoint(label: string): LoopbackEndpoint {
  const messageHandlers = new Set<(m: SignalingMessage) => void>();
  const errorHandlers = new Set<(e: unknown) => void>();
  let peer: LoopbackEndpoint | null = null;
  let connected = false;
  let closed = false;

  return {
    __setPeer(p: LoopbackEndpoint): void {
      peer = p;
    },

    __deliver(message: SignalingMessage): void {
      if (closed) {
        return;
      }
      for (const h of messageHandlers) {
        try {
          h(message);
        } catch (e) {
          // A handler throwing must not break delivery to others or the peer.
          for (const eh of errorHandlers) {
            try {
              eh(e);
            } catch {
              // ignore
            }
          }
        }
      }
    },

    async connect(): Promise<void> {
      connected = true;
    },

    send(message: SignalingMessage): void {
      if (closed || !connected) {
        // Match a real channel: silently drop once closed / before connect.
        return;
      }
      const target = peer;
      if (!target) {
        return;
      }
      // Deliver asynchronously so the loopback behaves like a real channel
      // (a `send` never re-enters the caller synchronously). A microtask via
      // Promise is used (queueMicrotask is not in the RN lib typings). __deliver
      // is total (its own try/catch), but the .catch keeps the chain non-floating.
      Promise.resolve()
        .then(() => target.__deliver(message))
        .catch(() => {});
    },

    onMessage(handler: (m: SignalingMessage) => void): () => void {
      messageHandlers.add(handler);
      return () => {
        messageHandlers.delete(handler);
      };
    },

    onError(handler: (e: unknown) => void): () => void {
      errorHandlers.add(handler);
      return () => {
        errorHandlers.delete(handler);
      };
    },

    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      connected = false;
      messageHandlers.clear();
      errorHandlers.clear();
      logger.debug('webrtc/signaling: loopback endpoint closed', { label });
    },
  };
}

/**
 * Create a connected pair of in-memory loopback transports.
 *
 * A message `send` on `a` is delivered to `b`'s `onMessage` handlers (and vice
 * versa), asynchronously. Use one endpoint per simulated device. Closing one
 * endpoint stops only that endpoint; the peer keeps its own state.
 *
 * @returns `{ a, b }` — two {@link SignalingTransport}s wired to each other.
 */
export function createLoopbackTransportPair(): {
  a: SignalingTransport;
  b: SignalingTransport;
} {
  const a = createLoopbackEndpoint('a');
  const b = createLoopbackEndpoint('b');
  a.__setPeer(b);
  b.__setPeer(a);
  return { a, b };
}

/**
 * Parameters for the (future) real local socket transport.
 *
 * The baby-unit's `host`/`port` are surfaced by mDNS discovery (DMY-7); the
 * `sessionId` scopes the signalling exchange. `role` decides whether this
 * endpoint listens (baby) or dials (parent) — both out of scope here.
 */
export interface LocalSocketTransportConfig {
  readonly host: string;
  readonly port: number;
  readonly sessionId: string;
  readonly role: 'initiator' | 'responder';
}

/**
 * INTEGRATION POINT (DMY-16): real local socket transport.
 *
 * Intentionally NOT implemented in this issue. A real implementation would open
 * a WebSocket/TCP channel between the two phones on the local network (the
 * baby-unit listening on its mDNS-advertised port, the parent-unit dialling it),
 * framing {@link SignalingMessage}s as JSON. It must satisfy the
 * {@link SignalingTransport} contract so the state machine works unchanged.
 *
 * Until then this throws, making the missing piece explicit rather than faking a
 * connection. Tests and the wiring use {@link createLoopbackTransportPair}.
 */
/* istanbul ignore next -- integration stub; not exercised by the unit suite. */
export function createLocalSocketTransport(
  _config: LocalSocketTransportConfig,
): SignalingTransport {
  throw new Error(
    'webrtc/signaling: real local socket transport is not implemented yet ' +
      '(DMY-16 integration point). Use createLoopbackTransportPair for tests.',
  );
}
