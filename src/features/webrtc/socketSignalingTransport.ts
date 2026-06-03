/**
 * socketSignalingTransport — the REAL local-network signalling transport (DMY-45).
 *
 * Replaces the throwing `createLocalSocketTransport` stub (DMY-16) with a
 * functional transport that carries {@link SignalingMessage}s as JSON between
 * the two phones over a local-network WebSocket on the baby-unit's
 * mDNS-advertised `host:port` (DMY-7):
 *
 *  - the **parent-unit** (initiator) DIALS `ws://host:port` with the platform's
 *    WebSocket *client*. React Native ships a WHATWG `WebSocket` client global,
 *    so the parent side is real today with NO extra native dependency.
 *  - the **baby-unit** (responder) must LISTEN for the parent's connection. React
 *    Native ships no WebSocket *server*, so the listen side is an injectable
 *    native seam ({@link SignalingServerFactory}); the shipped default surfaces a
 *    clear "not wired" error rather than faking a server. Wiring a tiny native
 *    `ws`-style listener (or a TCP module) is the remaining device milestone.
 *
 * ## Library choice (architectural default, DMY-45)
 * We deliberately do NOT add a third-party WS library to `package.json`:
 *   - the parent (dial) side uses the RN built-in `WebSocket` client — zero deps,
 *     already polyfilled on both platforms;
 *   - a server library would be a NATIVE module (no pure-JS WS server runs in
 *     the RN runtime), so it belongs behind the {@link SignalingServerFactory}
 *     seam and lands with the device milestone, not here.
 * Both the client factory and the server factory are INJECTABLE, so the whole
 * transport is unit-testable with an in-memory fake socket and never touches the
 * network under Jest.
 *
 * ## Contract
 * Implements {@link SignalingTransport} exactly (so the signalling state machine
 * is unchanged): `connect()` resolves once the socket is OPEN (rejects on a
 * connect error / close-before-open), `send()` frames the message as JSON and
 * never throws synchronously for a transient failure (it surfaces via
 * `onError`), `onMessage`/`onError` are pub/sub returning unsubscribes, and
 * `close()` is idempotent and silences further delivery.
 *
 * ## Privacy
 * The frames carry SDP/ICE (sensitive network metadata). NOTHING is logged with
 * a raw body — only coarse lifecycle facts go through the redacting logger
 * (which masks `sdp`/`candidate`). Message bodies never reach the logger.
 */
import { logger } from '../../services/logger';
import type { SignalingMessage, SignalingTransport } from './signalingTypes';

/**
 * Minimal structural type of a WHATWG WebSocket *client* — the subset we touch.
 * The RN global `WebSocket` satisfies this; tests pass a fake. We use the
 * single-slot `on*` handler properties (assigned, not `addEventListener`) which
 * both the RN client and a simple fake support.
 */
export interface WebSocketLike {
  /** Ready-state per the WHATWG spec (0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED). */
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data?: unknown }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onclose: ((event?: unknown) => void) | null;
}

/** WHATWG `WebSocket.OPEN`. Inlined so we do not depend on the constructor. */
const WS_OPEN = 1;

/**
 * Factory for a WebSocket *client* given a `ws://`/`wss://` url. Defaults to the
 * RN/global `WebSocket`; tests inject a fake that drives `onopen`/`onmessage`/
 * `onclose` synchronously.
 */
export type WebSocketFactory = (url: string) => WebSocketLike;

/**
 * Factory for the baby-unit's LISTEN side. Given the bind port + session id it
 * returns a transport that yields a single accepted parent connection. There is
 * no pure-JS WS server in the RN runtime, so the shipped default THROWS with
 * guidance; a native listener plugs in here. Kept separate from the client
 * factory so the parent (dial) path is fully functional without it.
 */
export type SignalingServerFactory = (
  config: LocalSocketTransportConfig,
) => SignalingTransport;

/**
 * Parameters for the local socket transport. `host`/`port` come from mDNS
 * discovery (DMY-7); `sessionId` scopes the exchange; `role` decides dial vs
 * listen (initiator dials, responder listens).
 */
export interface LocalSocketTransportConfig {
  readonly host: string;
  readonly port: number;
  readonly sessionId: string;
  readonly role: 'initiator' | 'responder';
}

/** Options for {@link createLocalSocketTransport}. */
export interface LocalSocketTransportOptions {
  /**
   * WebSocket *client* factory for the initiator (parent). Omit to use the
   * RN/global `WebSocket`; tests inject a fake.
   */
  readonly webSocketFactory?: WebSocketFactory;
  /**
   * LISTEN-side factory for the responder (baby). Omit to use the shipped
   * default, which throws with guidance (no JS WS server in RN); a native
   * listener plugs in here.
   */
  readonly serverFactory?: SignalingServerFactory;
}

/** Resolve the global WebSocket client constructor (RN/host), or `null`. */
/* istanbul ignore next -- native/global resolution; tests inject a factory. */
function resolveGlobalWebSocketFactory(): WebSocketFactory | null {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike })
    .WebSocket;
  if (typeof Ctor !== 'function') {
    return null;
  }
  return (url: string) => new Ctor(url);
}

/**
 * Build the `ws://host:port` url for the signalling endpoint. We use plain `ws`
 * (not `wss`): the link is the LOCAL network only and the media itself is
 * DTLS-SRTP encrypted regardless; a self-signed `wss` cert on a `.local` host
 * would only add friction. The session id is carried in-band (each message
 * stamps it) and validated by the state machine, so it is not put in the url.
 */
export function buildSignalingUrl(host: string, port: number): string {
  return `ws://${host}:${port}`;
}

/**
 * The default LISTEN-side factory (baby/responder). React Native has no
 * pure-JS WebSocket server, so this THROWS with guidance rather than faking a
 * connection. A native listener (a small `ws`-style module or a TCP socket
 * module) is the remaining device milestone and plugs into
 * {@link SignalingServerFactory}.
 */
/* istanbul ignore next -- intentional native seam; covered via an injected factory in tests. */
export function defaultSignalingServerFactory(): SignalingTransport {
  throw new Error(
    'webrtc/signaling: no local WebSocket SERVER is available in the RN ' +
      'runtime. The baby-unit (responder) listen side needs a native listener ' +
      '(SignalingServerFactory) — that is the remaining device milestone ' +
      '(DMY-45). The parent-unit (initiator) dial side is functional.',
  );
}

/**
 * Create the REAL local socket {@link SignalingTransport} (DMY-45).
 *
 *  - `role: 'initiator'` (parent) → a WebSocket *client* that dials
 *    `ws://host:port`. Functional with the RN built-in client.
 *  - `role: 'responder'` (baby) → delegates to the injected
 *    {@link SignalingServerFactory} (the native listen seam; the default
 *    throws with guidance).
 *
 * Satisfies {@link SignalingTransport} so the state machine is unchanged.
 */
export function createLocalSocketTransport(
  config: LocalSocketTransportConfig,
  options: LocalSocketTransportOptions = {},
): SignalingTransport {
  if (config.role === 'responder') {
    const serverFactory =
      options.serverFactory ?? defaultSignalingServerFactory;
    return serverFactory(config);
  }
  return createDialingTransport(config, options);
}

/**
 * The parent/initiator DIAL transport over a WebSocket client. Frames messages
 * as JSON; buffers `send`s issued before the socket is OPEN and flushes them on
 * open (so a `send` racing the handshake is never silently lost).
 */
function createDialingTransport(
  config: LocalSocketTransportConfig,
  options: LocalSocketTransportOptions,
): SignalingTransport {
  const factory =
    options.webSocketFactory ?? resolveGlobalWebSocketFactory();
  const messageHandlers = new Set<(m: SignalingMessage) => void>();
  const errorHandlers = new Set<(e: unknown) => void>();
  // Messages enqueued before the socket reaches OPEN, flushed on open.
  const preOpenQueue: SignalingMessage[] = [];

  let socket: WebSocketLike | null = null;
  let open = false;
  let closed = false;

  function emitError(error: unknown): void {
    for (const h of errorHandlers) {
      try {
        h(error);
      } catch {
        // A subscriber must never break delivery to the others.
      }
    }
  }

  function deliver(message: SignalingMessage): void {
    for (const h of messageHandlers) {
      try {
        h(message);
      } catch {
        // Isolate a misbehaving subscriber.
      }
    }
  }

  /** Parse + validate an inbound frame to a {@link SignalingMessage} or null. */
  function parseFrame(data: unknown): SignalingMessage | null {
    if (typeof data !== 'string') {
      return null;
    }
    try {
      const parsed = JSON.parse(data) as { type?: unknown };
      const type = parsed?.type;
      if (
        type === 'offer' ||
        type === 'answer' ||
        type === 'ice-candidate' ||
        type === 'bye'
      ) {
        return parsed as SignalingMessage;
      }
      return null;
    } catch {
      // A malformed frame is dropped (never thrown): a peer/foreign sender
      // putting garbage on the socket must not crash signalling.
      logger.warn('webrtc/signaling: dropped malformed socket frame');
      return null;
    }
  }

  function rawSend(message: SignalingMessage): void {
    const s = socket;
    if (!s || s.readyState !== WS_OPEN) {
      return;
    }
    try {
      // JSON only; the redactor never sees this string (it is not logged).
      s.send(JSON.stringify(message));
    } catch (error) {
      logger.error('webrtc/signaling: socket send failed');
      emitError(error);
    }
  }

  return {
    connect(): Promise<void> {
      if (closed) {
        return Promise.reject(
          new Error('webrtc/signaling: transport already closed'),
        );
      }
      if (!factory) {
        return Promise.reject(
          new Error(
            'webrtc/signaling: no WebSocket client available (native/global missing)',
          ),
        );
      }
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const url = buildSignalingUrl(config.host, config.port);
        let s: WebSocketLike;
        try {
          s = factory(url);
        } catch (error) {
          reject(error);
          return;
        }
        socket = s;

        s.onopen = () => {
          open = true;
          // Flush any messages enqueued before the socket opened.
          const pending = preOpenQueue.splice(0);
          for (const m of pending) {
            rawSend(m);
          }
          logger.info('webrtc/signaling: socket open');
          if (!settled) {
            settled = true;
            resolve();
          }
        };

        s.onmessage = event => {
          const message = parseFrame(event?.data);
          if (message) {
            deliver(message);
          }
        };

        s.onerror = error => {
          logger.warn('webrtc/signaling: socket error');
          // A connect-time error rejects connect(); a post-open error is
          // surfaced via onError so the session maps it to a failure.
          if (!settled) {
            settled = true;
            reject(error ?? new Error('webrtc/signaling: socket error'));
            return;
          }
          emitError(error ?? new Error('webrtc/signaling: socket error'));
        };

        s.onclose = () => {
          open = false;
          logger.info('webrtc/signaling: socket closed');
          if (!settled) {
            // Closed before it ever opened → a failed connect.
            settled = true;
            reject(new Error('webrtc/signaling: socket closed before open'));
            return;
          }
          // A drop AFTER open is a transport error for an established session.
          if (!closed) {
            emitError(new Error('webrtc/signaling: socket closed'));
          }
        };
      });
    },

    send(message: SignalingMessage): void {
      if (closed) {
        return;
      }
      if (!open) {
        // Enqueue until the socket opens; flushed in onopen. Never throws.
        preOpenQueue.push(message);
        return;
      }
      rawSend(message);
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
      open = false;
      preOpenQueue.splice(0);
      messageHandlers.clear();
      errorHandlers.clear();
      const s = socket;
      socket = null;
      if (s) {
        // Detach handlers so a late native callback cannot reach a torn-down
        // transport (no use-after-close), then close the socket.
        s.onopen = null;
        s.onmessage = null;
        s.onerror = null;
        s.onclose = null;
        try {
          s.close();
        } catch {
          logger.warn('webrtc/signaling: error closing socket');
        }
      }
      logger.info('webrtc/signaling: socket transport closed');
    },
  };
}
