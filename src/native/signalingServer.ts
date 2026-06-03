/**
 * signalingServer — typed JS wrapper over the native baby-side WebSocket
 * signalling SERVER (DMY-72).
 *
 * ## Why this exists
 * React Native ships a WHATWG `WebSocket` *client* but NO WebSocket *server*: the
 * baby-unit (responder) cannot accept a parent's dial from pure JS. DMY-45 left
 * the listen side behind an injectable seam ({@link SignalingServerFactory} /
 * {@link MultiClientSignalingTransport}) whose shipped default throws → the
 * baby-side fan-out (DMY-66) stays inert. This module is the THIN, typed bridge
 * over the native listener that lights that seam up:
 *  - iOS — a Swift `Network.framework` `NWListener` + RFC 6455 WS framing
 *    (`SignalingServer.swift`, Obj-C `RCT_EXTERN_MODULE` bridge).
 *  - Android — a Kotlin `org.java-websocket` server
 *    (`SignalingServerModule.kt` + `SignalingServerPackage`).
 *
 * Both expose the SAME native surface (a small imperative `start/send/
 * closeClient/stop` + an event stream), so this wrapper is platform-agnostic.
 *
 * ## Contract (mirrors the native modules)
 *  - `start({ port, sessionId })` — bind + listen for parent dials, validating
 *    the shared secret (the ephemeral `sessionId` from the QR payload, DMY-6) on
 *    the upgrade. Resolves with the ACTUAL bound port (the native side probes
 *    `8443..8453`, DMY-72 default, so a busy port falls through). Rejects if no
 *    port is free or the listener cannot bind.
 *  - `send(clientId, message)` — frame `message` (already a JSON string) to ONE
 *    accepted parent. Best-effort; a write to a gone client is swallowed natively.
 *  - `closeClient(clientId)` — close ONE parent's socket (used to reject a parent
 *    over the cap, DMY-66).
 *  - `stop()` — tear the whole listener + all client sockets down. Idempotent.
 *  - Events (via {@link NativeEventEmitter}): `onConnection { clientId }` (AFTER
 *    the shared-secret check passes), `onMessage { clientId, data }`,
 *    `onClose { clientId }`, `onError { message }`.
 *
 * ## Safe degradation (Jest / unlinked / wrong platform)
 * The native module is absent under Jest and on a build where it is not linked.
 * {@link resolveSignalingServerModule} returns `undefined` in that case and
 * callers ({@link createNativeSignalingServer}) degrade to "no server" — exactly
 * the inert posture the fan-out already handles. NOTHING here throws on a missing
 * module, so Jest tests never need the native side.
 *
 * ## Privacy
 * The frames carry SDP/ICE (sensitive network metadata) and the `sessionId` is a
 * short-lived pairing secret. This wrapper NEVER logs a message body, a client id
 * or the shared secret — only coarse, non-PII lifecycle facts through the
 * redacting logger.
 */
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

import { logger } from '../services/logger';

/** Event payload: a parent connected (AFTER the shared-secret check passed). */
export interface SignalingServerConnectionEvent {
  /** Opaque per-connection id assigned by the native listener. */
  readonly clientId: string;
}

/** Event payload: a text frame arrived from one parent. */
export interface SignalingServerMessageEvent {
  readonly clientId: string;
  /** The raw text frame (a JSON-encoded {@link SignalingMessage}). */
  readonly data: string;
}

/** Event payload: a parent's socket closed (cleanly or not). */
export interface SignalingServerCloseEvent {
  readonly clientId: string;
}

/** Event payload: a listener-level error (bind failure, accept loop error). */
export interface SignalingServerErrorEvent {
  /** A coarse, non-PII description (never a body or the shared secret). */
  readonly message: string;
}

/** Parameters for {@link NativeSignalingServerModule.start}. */
export interface SignalingServerStartParams {
  /**
   * Preferred bind port. The native side probes `port..port+10` and binds the
   * first free one, returning the actual port. DMY-72 default is `8443`.
   */
  readonly port: number;
  /**
   * Shared secret for the upgrade check — the ephemeral pairing `sessionId` from
   * the QR payload (DMY-6). A parent that does not present it is rejected before
   * any `onConnection` event fires.
   */
  readonly sessionId: string;
}

/**
 * The raw native module surface (structural so the TS layer is fully unit-
 * testable against a tiny mock with no native dependency). Methods are promise-
 * returning where a result/failure matters; fire-and-forget where best-effort.
 */
export interface NativeSignalingServerModule {
  /** Bind + listen; resolves with the ACTUAL bound port. */
  start(params: SignalingServerStartParams): Promise<number>;
  /** Frame a JSON string to ONE accepted parent (best-effort). */
  send(clientId: string, message: string): void;
  /** Close ONE parent's socket. */
  closeClient(clientId: string): void;
  /** Tear the whole listener + all sockets down (idempotent). */
  stop(): Promise<void>;
  /**
   * RN requires `addListener`/`removeListeners` on a module backing a
   * {@link NativeEventEmitter}. They may be no-ops natively but must exist.
   */
  addListener(eventType: string): void;
  removeListeners(count: number): void;
}

/** Minimal structural shape of a subscription (just what we call: `remove`). */
export interface SignalingServerSubscription {
  remove(): void;
}

/**
 * Minimal structural shape of the event source we need — just `addListener`
 * returning something removable. A real {@link NativeEventEmitter} satisfies it;
 * tests pass a tiny fake with no RN native dependency.
 */
export interface SignalingServerEmitter {
  addListener(
    eventType: string,
    listener: (event: never) => void,
  ): SignalingServerSubscription;
}

/** The native event names this module emits. Kept in one place for both sides. */
export const SIGNALING_SERVER_EVENTS = {
  connection: 'SignalingServerConnection',
  message: 'SignalingServerMessage',
  close: 'SignalingServerClose',
  error: 'SignalingServerError',
} as const;

/** The JS name the native bridge registers the module under. */
const NATIVE_MODULE_NAME = 'SignalingServer';

/**
 * Lazily resolve the native module, returning `undefined` when it is absent
 * (Jest, an unlinked build). Resolved fresh on each call (a cheap property read)
 * so a test can swap `NativeModules` between cases. Unlike the audio modules this
 * is NOT platform-gated: both iOS and Android ship a `SignalingServer`, so we
 * accept it on either platform and only fall back when it is genuinely missing.
 */
export function resolveSignalingServerModule():
  | NativeSignalingServerModule
  | undefined {
  // Only the two mobile platforms ship the bridge; under Jest Platform.OS is one
  // of these but the module is unregistered, so the shape check below still
  // yields undefined. The guard mainly documents intent + skips a web lookup.
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return undefined;
  }
  const native = (NativeModules as Record<string, unknown>)[NATIVE_MODULE_NAME];
  if (
    native &&
    typeof (native as NativeSignalingServerModule).start === 'function' &&
    typeof (native as NativeSignalingServerModule).send === 'function' &&
    typeof (native as NativeSignalingServerModule).closeClient === 'function' &&
    typeof (native as NativeSignalingServerModule).stop === 'function'
  ) {
    return native as NativeSignalingServerModule;
  }
  return undefined;
}

/** Handlers a caller can subscribe on a {@link SignalingServer}. */
export interface SignalingServerHandlers {
  readonly onConnection?: (event: SignalingServerConnectionEvent) => void;
  readonly onMessage?: (event: SignalingServerMessageEvent) => void;
  readonly onClose?: (event: SignalingServerCloseEvent) => void;
  readonly onError?: (event: SignalingServerErrorEvent) => void;
}

/**
 * A typed, lifecycle-managed handle over the native listener. Owns the
 * {@link NativeEventEmitter} subscriptions so a caller never touches the raw
 * event names, and guarantees `stop()` removes every subscription (no leak / no
 * late callback into a torn-down consumer).
 */
export interface SignalingServer {
  /** Bind + listen; resolves with the ACTUAL bound port. */
  start(params: SignalingServerStartParams): Promise<number>;
  /** Frame a JSON string to ONE accepted parent (best-effort, never throws). */
  send(clientId: string, message: string): void;
  /** Close ONE parent's socket (e.g. reject over the cap). */
  closeClient(clientId: string): void;
  /** Tear everything down + drop all subscriptions. Idempotent. */
  stop(): void;
}

/**
 * Build a {@link SignalingServer} over the native module. When the module is
 * absent this returns `undefined` so callers degrade to "no server" (inert),
 * matching the seam the fan-out already handles.
 *
 * @param handlers Event callbacks; each is optional.
 * @param nativeModule Inject a fake in tests; defaults to the lazily-resolved
 *   native module.
 * @param emitter Inject a fake emitter in tests; defaults to a real
 *   {@link NativeEventEmitter} over the resolved module.
 */
export function createSignalingServer(
  handlers: SignalingServerHandlers,
  nativeModule: NativeSignalingServerModule | undefined = resolveSignalingServerModule(),
  emitter?: SignalingServerEmitter,
): SignalingServer | undefined {
  if (!nativeModule) {
    return undefined;
  }

  // A NativeEventEmitter needs a module exposing addListener/removeListeners; the
  // native side provides them. Tests can pass a fake emitter to avoid the RN
  // native dependency entirely.
  const events: SignalingServerEmitter =
    emitter ??
    (new NativeEventEmitter(
      nativeModule as unknown as ConstructorParameters<
        typeof NativeEventEmitter
      >[0],
    ) as unknown as SignalingServerEmitter);

  const subscriptions: SignalingServerSubscription[] = [];
  let stopped = false;

  function subscribe<T>(
    name: string,
    handler: ((event: T) => void) | undefined,
  ): void {
    if (!handler) {
      return;
    }
    // Isolate a throwing subscriber so one bad handler cannot break the others
    // or leave the native side thinking delivery failed.
    const safe = (event: T): void => {
      try {
        handler(event);
      } catch {
        logger.warn('native/signalingServer: event handler threw', { name });
      }
    };
    const sub = events.addListener(
      name,
      safe as (event: never) => void,
    );
    subscriptions.push(sub);
  }

  subscribe<SignalingServerConnectionEvent>(
    SIGNALING_SERVER_EVENTS.connection,
    handlers.onConnection,
  );
  subscribe<SignalingServerMessageEvent>(
    SIGNALING_SERVER_EVENTS.message,
    handlers.onMessage,
  );
  subscribe<SignalingServerCloseEvent>(
    SIGNALING_SERVER_EVENTS.close,
    handlers.onClose,
  );
  subscribe<SignalingServerErrorEvent>(
    SIGNALING_SERVER_EVENTS.error,
    handlers.onError,
  );

  function dropSubscriptions(): void {
    for (const sub of subscriptions.splice(0)) {
      try {
        sub.remove();
      } catch {
        // ignore — best-effort.
      }
    }
  }

  return {
    start(params: SignalingServerStartParams): Promise<number> {
      if (stopped) {
        return Promise.reject(
          new Error('native/signalingServer: server already stopped'),
        );
      }
      return nativeModule.start(params);
    },

    send(clientId: string, message: string): void {
      if (stopped) {
        return;
      }
      try {
        nativeModule.send(clientId, message);
      } catch {
        // Best-effort: a write to a gone client must never crash signalling.
        logger.warn('native/signalingServer: send failed');
      }
    },

    closeClient(clientId: string): void {
      if (stopped) {
        return;
      }
      try {
        nativeModule.closeClient(clientId);
      } catch {
        // ignore — best-effort close.
      }
    },

    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;
      // Drop JS subscriptions FIRST so a native callback fired during teardown
      // cannot reach a consumer that thinks it is gone.
      dropSubscriptions();
      try {
        // start() may never have resolved; stop() is idempotent natively. The
        // .catch keeps a rejected teardown from floating as an unhandled
        // rejection (a failed teardown must never crash the JS side).
        nativeModule.stop().catch(() => {});
      } catch {
        // ignore — best-effort teardown.
      }
      logger.info('native/signalingServer: stopped');
    },
  };
}
