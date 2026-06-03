/**
 * signalingServerNative — the REAL baby-side LISTEN transport, backed by the
 * native WebSocket SERVER (DMY-72).
 *
 * DMY-45 defined two listen-side seams the baby-unit needs but RN cannot satisfy
 * from JS (no WS server in the runtime):
 *  - {@link SignalingServerFactory} — the 1:1 responder transport for
 *    {@link useMediaSession} (one parent), and
 *  - {@link MultiClientSignalingTransport} — the fan-out accept loop for
 *    {@link createBabyBroadcast} (DMY-66, N parents).
 *
 * This module implements BOTH on top of the single native listener
 * ({@link SignalingServer} → `NativeModules.SignalingServer`):
 *  - {@link createNativeBroadcastTransport} → the multi-client accept loop. This
 *    is the PRIMARY path wired into the baby screen (multi-parent broadcast), per
 *    DMY-72's instruction to inject into the fan-out path.
 *  - {@link createNativeSignalingServerFactory} → the 1:1 factory (one accepted
 *    parent surfaced as a single {@link SignalingTransport}). It is NOT wired into
 *    the baby screen: DMY-75 unified the baby publish path onto the fan-out
 *    manager (the 1:1 case is just N=1 there), so only the broadcast accept loop
 *    binds the port — never two listeners competing for it. The factory remains a
 *    tested seam (it reuses the same native listener framing) should a dedicated
 *    1:1 baby flavour ever be needed.
 *
 * ## How a parent maps to a per-client transport
 * The native listener accepts a parent dial, validates the shared secret
 * (`sessionId`) on the WS upgrade, assigns an opaque `clientId`, and emits
 * `onConnection`. For each such client we hand the fan-out a per-client
 * {@link SignalingTransport} whose:
 *  - `send` serialises the {@link SignalingMessage} to JSON and routes it to THAT
 *    client via `nativeServer.send(clientId, json)`;
 *  - `onMessage` is fed by the native `onMessage` events filtered to this client,
 *    parsed + validated to a {@link SignalingMessage} (garbage is dropped, never
 *    thrown);
 *  - `connect()` resolves immediately — the socket is ALREADY accepted by the
 *    time the client surfaces (the parent dialled us), so there is nothing to
 *    dial back;
 *  - `close()` closes only THAT client's socket.
 *
 * ## Safe degradation (Jest / unlinked / wrong platform)
 * When the native module is absent {@link createNativeBroadcastTransport} returns
 * `undefined` and {@link createNativeSignalingServerFactory} returns a factory
 * that THROWS (matching {@link defaultSignalingServerFactory}) — so the existing
 * inert behaviour is preserved and Jest never needs the native side.
 *
 * ## Privacy
 * Frames carry SDP/ICE and the `sessionId` is a short-lived secret. NOTHING here
 * logs a body, a client id or the secret — only coarse lifecycle facts.
 */
import { logger } from '../../services/logger';
import {
  createSignalingServer,
  resolveSignalingServerModule,
  type NativeSignalingServerModule,
  type SignalingServer,
  type SignalingServerHandlers,
} from '../../native/signalingServer';
import type {
  MultiClientSignalingTransport,
} from './babyBroadcast';
import type {
  LocalSocketTransportConfig,
  SignalingServerFactory,
} from './socketSignalingTransport';
import type {
  SignalingMessage,
  SignalingTransport,
} from './signalingTypes';

/**
 * DMY-72 default signalling port. The native listener probes `8443..8453` and
 * binds the first free one, so a busy 8443 (e.g. a stale session) falls through
 * rather than failing the bind.
 */
export const DEFAULT_SIGNALING_PORT = 8443;

/** Options for the native broadcast transport. */
export interface NativeBroadcastTransportOptions {
  /**
   * Shared secret checked on the WS upgrade — the ephemeral pairing `sessionId`
   * from the QR payload (DMY-6). A parent that does not present it is rejected by
   * the native side before any client surfaces here.
   */
  readonly sessionId: string;
  /** Preferred bind port (default {@link DEFAULT_SIGNALING_PORT}). */
  readonly port?: number;
  /**
   * Inject a native module in tests; defaults to the lazily-resolved one. When
   * absent (and no `createServer` override), the factory returns `undefined`
   * (inert).
   */
  readonly nativeModule?: NativeSignalingServerModule;
  /**
   * Override how the underlying {@link SignalingServer} is built from the wired
   * handlers (tests inject a fake that drives the events synchronously). Defaults
   * to {@link createSignalingServer} over the resolved/injected native module.
   * Returning `undefined` keeps the transport inert.
   */
  readonly createServer?: (
    handlers: SignalingServerHandlers,
  ) => SignalingServer | undefined;
}

/**
 * Build a per-client {@link SignalingTransport} for ONE accepted parent. The
 * socket is already open (the parent dialled us), so `connect()` resolves
 * immediately; inbound frames are pushed in via {@link deliver}; outbound frames
 * are routed to this client through the shared native server.
 *
 * @internal Exported for unit tests; the accept loop wires it up.
 */
export interface PerClientTransport extends SignalingTransport {
  /** @internal Push a raw inbound frame (already filtered to this client). */
  __deliverRaw(data: string): void;
  /** @internal Signal that the underlying socket closed (native onClose). */
  __socketClosed(): void;
}

/** Parse + validate a raw frame to a {@link SignalingMessage} or null. */
function parseFrame(data: string): SignalingMessage | null {
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
    // A foreign/garbage frame must never crash signalling.
    logger.warn('webrtc/signaling: dropped malformed server frame');
    return null;
  }
}

export function createPerClientTransport(
  clientId: string,
  server: Pick<SignalingServer, 'send' | 'closeClient'>,
): PerClientTransport {
  const messageHandlers = new Set<(m: SignalingMessage) => void>();
  const errorHandlers = new Set<(e: unknown) => void>();
  let closed = false;

  function deliver(message: SignalingMessage): void {
    for (const h of messageHandlers) {
      try {
        h(message);
      } catch {
        // Isolate a misbehaving subscriber.
      }
    }
  }

  function emitError(error: unknown): void {
    for (const h of errorHandlers) {
      try {
        h(error);
      } catch {
        // Isolate a misbehaving subscriber.
      }
    }
  }

  return {
    // The parent already dialled in — the socket is open by the time this client
    // surfaces, so there is nothing to establish. Resolve immediately.
    connect(): Promise<void> {
      if (closed) {
        return Promise.reject(
          new Error('webrtc/signaling: per-client transport already closed'),
        );
      }
      return Promise.resolve();
    },

    send(message: SignalingMessage): void {
      if (closed) {
        return;
      }
      // JSON only; never logged. Routed to THIS client over the shared listener.
      server.send(clientId, JSON.stringify(message));
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
      messageHandlers.clear();
      errorHandlers.clear();
      try {
        server.closeClient(clientId);
      } catch {
        // Best-effort; the native side tolerates closing a gone client.
      }
    },

    __deliverRaw(data: string): void {
      if (closed) {
        return;
      }
      const message = parseFrame(data);
      if (message) {
        deliver(message);
      }
    },

    __socketClosed(): void {
      if (closed) {
        return;
      }
      // A drop at the socket level is a transport error for this peer's session;
      // the per-peer state machine maps it to a failure. We do NOT call close()
      // here (the native socket is already gone) — just surface the error and
      // stop further delivery.
      closed = true;
      emitError(new Error('webrtc/signaling: client socket closed'));
      messageHandlers.clear();
      errorHandlers.clear();
    },
  };
}

/**
 * Create the baby-side multi-client accept loop ({@link MultiClientSignalingTransport})
 * backed by the native listener. This is the PRIMARY listen path injected into
 * the fan-out (DMY-66) on the baby screen.
 *
 * Returns `undefined` when the native module is absent (Jest / unlinked) so the
 * caller degrades to the existing inert posture.
 */
export function createNativeBroadcastTransport(
  options: NativeBroadcastTransportOptions,
): MultiClientSignalingTransport | undefined {
  const { sessionId, port = DEFAULT_SIGNALING_PORT } = options;

  const connectHandlers = new Set<
    (clientId: string, transport: SignalingTransport) => void
  >();
  const disconnectHandlers = new Set<(clientId: string) => void>();
  // One per-client transport per accepted parent, keyed by the native clientId.
  const clients = new Map<string, PerClientTransport>();

  let server: SignalingServer | undefined;
  let started = false;
  let closed = false;

  // Wire the native events to the per-client transports. The server is created
  // up front so its subscriptions exist before start() accepts a connection.
  const handlers: SignalingServerHandlers = {
    onConnection: ({ clientId }) => {
      if (closed) {
        return;
      }
      if (clients.has(clientId)) {
        // Defensive: a native double-emit must not spawn two transports.
        return;
      }
      // `server` is set below before start(); the non-null assertion is safe
      // because onConnection can only fire after start() which needs `server`.
      const transport = createPerClientTransport(clientId, server!);
      clients.set(clientId, transport);
      for (const h of connectHandlers) {
        try {
          h(clientId, transport);
        } catch {
          // A subscriber must never break the accept loop.
        }
      }
    },
    onMessage: ({ clientId, data }) => {
      clients.get(clientId)?.__deliverRaw(data);
    },
    onClose: ({ clientId }) => {
      const transport = clients.get(clientId);
      if (!transport) {
        return;
      }
      clients.delete(clientId);
      // Surface to the per-peer session (transport error) AND to the accept
      // loop's disconnect subscribers (the fan-out tears that peer down).
      transport.__socketClosed();
      for (const h of disconnectHandlers) {
        try {
          h(clientId);
        } catch {
          // ignore
        }
      }
    },
    onError: ({ message }) => {
      // Listener-level error (bind/accept). Coarse, non-PII; never the secret.
      logger.warn('webrtc/signaling: native server error', { message });
    },
  };

  const build =
    options.createServer ??
    ((h: SignalingServerHandlers) =>
      createSignalingServer(
        h,
        options.nativeModule ?? resolveSignalingServerModule(),
      ));
  server = build(handlers);

  if (!server) {
    // No native listener available — stay honest: no transport (inert).
    return undefined;
  }

  return {
    onClientConnect(handler): () => void {
      connectHandlers.add(handler);
      return () => {
        connectHandlers.delete(handler);
      };
    },

    onClientDisconnect(handler): () => void {
      disconnectHandlers.add(handler);
      return () => {
        disconnectHandlers.delete(handler);
      };
    },

    async start(): Promise<void> {
      if (started || closed) {
        return;
      }
      started = true;
      const boundPort = await server!.start({ port, sessionId });
      logger.info('webrtc/signaling: native listener bound', {
        port: boundPort,
      });
    },

    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      connectHandlers.clear();
      disconnectHandlers.clear();
      for (const transport of clients.values()) {
        try {
          transport.close();
        } catch {
          // ignore — best-effort.
        }
      }
      clients.clear();
      server!.stop();
    },
  };
}

/**
 * Create a {@link SignalingServerFactory} (the DMY-45 1:1 listen seam) backed by
 * the native listener. Provided for the LATER 1:1 wiring task (DMY-75); not
 * injected by DMY-72 (only one path binds the port). When the native module is
 * absent it returns a factory that THROWS like
 * {@link defaultSignalingServerFactory}, preserving the inert behaviour.
 *
 * The factory yields a transport that surfaces the FIRST accepted parent as the
 * single 1:1 channel and ignores additional dials (a 1:1 monitor has one parent).
 */
export function createNativeSignalingServerFactory(
  sessionId: string,
  port: number = DEFAULT_SIGNALING_PORT,
  nativeModule: NativeSignalingServerModule | undefined = resolveSignalingServerModule(),
): SignalingServerFactory {
  return (_config: LocalSocketTransportConfig): SignalingTransport => {
    // The 1:1 transport owns its OWN handler sets (subscribed BEFORE the parent
    // dials, by the signalling session) and forwards native events for the first
    // accepted client. It does NOT delegate to a per-client transport (which
    // would not exist yet at subscription time).
    const messageHandlers = new Set<(m: SignalingMessage) => void>();
    const errorHandlers = new Set<(e: unknown) => void>();
    let activeClientId: string | null = null;
    let connectResolve: (() => void) | null = null;
    let connectReject: ((e: unknown) => void) | null = null;
    let started = false;
    let closed = false;

    function deliver(message: SignalingMessage): void {
      for (const h of messageHandlers) {
        try {
          h(message);
        } catch {
          // Isolate a misbehaving subscriber.
        }
      }
    }
    function emitError(error: unknown): void {
      for (const h of errorHandlers) {
        try {
          h(error);
        } catch {
          // Isolate a misbehaving subscriber.
        }
      }
    }

    const handlers: SignalingServerHandlers = {
      onConnection: ({ clientId }) => {
        if (closed || activeClientId !== null) {
          // 1:1: ignore extra dials once one parent is bound.
          return;
        }
        activeClientId = clientId;
        connectResolve?.();
        connectResolve = null;
        connectReject = null;
      },
      onMessage: ({ clientId, data }) => {
        if (clientId !== activeClientId) {
          return;
        }
        const message = parseFrame(data);
        if (message) {
          deliver(message);
        }
      },
      onClose: ({ clientId }) => {
        if (clientId === activeClientId && !closed) {
          emitError(new Error('webrtc/signaling: client socket closed'));
        }
      },
      onError: ({ message }) => {
        logger.warn('webrtc/signaling: native server error', { message });
        if (connectReject) {
          connectReject(new Error('webrtc/signaling: native server error'));
          connectReject = null;
          connectResolve = null;
        } else if (!closed) {
          emitError(new Error('webrtc/signaling: native server error'));
        }
      },
    };

    const srv = createSignalingServer(handlers, nativeModule);

    if (!srv) {
      // Mirror defaultSignalingServerFactory: no native listener → throw with
      // guidance so the caller degrades to inert exactly as before.
      throw new Error(
        'webrtc/signaling: native SignalingServer module is not available ' +
          '(absent under Jest / on an unlinked build). The baby-unit 1:1 listen ' +
          'side needs the native listener (DMY-72).',
      );
    }

    return {
      connect(): Promise<void> {
        if (closed) {
          return Promise.reject(
            new Error('webrtc/signaling: listen transport already closed'),
          );
        }
        // Resolve when the FIRST parent is accepted; until then connect() is
        // pending (the responder waits for the dial, like a real listener).
        return new Promise<void>((resolve, reject) => {
          if (activeClientId !== null) {
            resolve();
            return;
          }
          connectResolve = resolve;
          connectReject = reject;
          if (!started) {
            started = true;
            srv.start({ port, sessionId }).catch(error => {
              connectReject?.(error);
              connectReject = null;
              connectResolve = null;
            });
          }
        });
      },

      send(message: SignalingMessage): void {
        if (closed || activeClientId === null) {
          return;
        }
        srv.send(activeClientId, JSON.stringify(message));
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
        messageHandlers.clear();
        errorHandlers.clear();
        activeClientId = null;
        srv.stop();
      },
    };
  };
}
