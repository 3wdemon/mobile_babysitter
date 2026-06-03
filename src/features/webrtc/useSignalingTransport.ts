/**
 * useSignalingTransport — resolve the REAL signalling transport for the screens
 * (DMY-45, part 2).
 *
 * The media hooks (useAudioStream / useVideoStream → useSignaling) take an
 * INJECTED {@link SignalingTransport} and stay inert without one (they never
 * fabricate a connection). This hook builds the right transport for the current
 * device `role` + paired session and hands it to those hooks, so the pipeline is
 * live end-to-end on the screens:
 *
 *  - **parent-unit (initiator)** DIALS the baby-unit's mDNS-advertised
 *    `host:port` (DMY-7). The endpoint is taken from `connection` (resolved at
 *    pairing time) when present. With the RN built-in WebSocket client this side
 *    is functional today.
 *  - **baby-unit (responder)** must LISTEN. React Native ships no JS WebSocket
 *    server, so the listen side is the injectable native seam
 *    ({@link SignalingServerFactory}); the shipped default throws → no transport
 *    → the hook stays inert (HONEST: the baby cannot accept a dial until the
 *    native listener lands). Pass `serverFactory` once the native module exists.
 *
 * ## Honest degradation
 * When there is no paired session, no resolvable endpoint (parent) or no native
 * listener (baby), this returns `undefined` — exactly the "no transport" posture
 * the media hooks already handle. Nothing is faked; the existing paired screens
 * keep working unchanged.
 *
 * ## Lifetime
 * One transport per (role × sessionId × endpoint × factory identity). The
 * transport is owned by the consuming hook (useSignaling closes it on teardown);
 * this hook only constructs it and closes a stale one when the identity changes.
 */
import { useEffect, useMemo, useRef } from 'react';

import { useAppStore } from '../../store/useAppStore';
import { logger } from '../../services/logger';
import { createLocalSocketTransport } from './socketSignalingTransport';
import type {
  LocalSocketTransportOptions,
  SignalingServerFactory,
  WebSocketFactory,
} from './socketSignalingTransport';
import type { SignalingTransport } from './signalingTypes';

/** A resolved baby-unit signalling endpoint (host:port). */
export interface SignalingEndpoint {
  readonly host: string;
  readonly port: number;
}

/** Options for {@link useSignalingTransport}. */
export interface UseSignalingTransportOptions {
  /**
   * The baby-unit endpoint to dial (parent-unit only). Typically threaded from
   * mDNS discovery (DMY-7) for the paired session id. Omit when unknown — the
   * parent then has nothing to dial and the hook returns `undefined`.
   */
  readonly endpoint?: SignalingEndpoint | null;
  /**
   * WebSocket *client* factory (parent dial side). Omit to use the RN/global
   * `WebSocket`; tests inject a fake to drive the socket synchronously.
   */
  readonly webSocketFactory?: WebSocketFactory;
  /**
   * LISTEN-side factory (baby-unit). Omit to use the shipped default (which
   * throws → inert, since RN has no JS WS server); pass a native listener once
   * it exists. Tests inject a fake to exercise the responder path.
   */
  readonly serverFactory?: SignalingServerFactory;
}

export function useSignalingTransport(
  options: UseSignalingTransportOptions = {},
): SignalingTransport | undefined {
  const { endpoint, webSocketFactory, serverFactory } = options;

  const role = useAppStore(s => s.role);
  const pairedSessionId = useAppStore(s => s.pairedSessionId);

  // Identity key: rebuild the transport only when something material changes.
  const host = endpoint?.host ?? null;
  const port = endpoint?.port ?? null;

  const transport = useMemo<SignalingTransport | undefined>(() => {
    if (!pairedSessionId) {
      return undefined;
    }
    if (role === 'parent') {
      // Parent dials; needs a concrete endpoint.
      if (host === null || port === null) {
        return undefined;
      }
      const txOptions: LocalSocketTransportOptions = webSocketFactory
        ? { webSocketFactory }
        : {};
      return createLocalSocketTransport(
        { host, port, sessionId: pairedSessionId, role: 'initiator' },
        txOptions,
      );
    }
    if (role === 'baby') {
      // Baby listens; without a native listener the default factory throws —
      // we degrade to "no transport" (inert) rather than letting it crash.
      try {
        return createLocalSocketTransport(
          {
            // host/port are the bind side; the advertised port is the discovery
            // default — the listener owns the real bind.
            host: host ?? '0.0.0.0',
            port: port ?? 0,
            sessionId: pairedSessionId,
            role: 'responder',
          },
          serverFactory ? { serverFactory } : {},
        );
      } catch {
        logger.info(
          'webrtc/signaling: no listen transport (native listener not wired) — inert',
        );
        return undefined;
      }
    }
    return undefined;
  }, [role, pairedSessionId, host, port, webSocketFactory, serverFactory]);

  // Close a stale transport when the identity changes / on unmount IF the
  // consumer never took ownership. useSignaling closes the one it uses on
  // teardown; this guards the window where a new transport replaced an old one
  // that was never connected (e.g. endpoint changed before a session started).
  const prevRef = useRef<SignalingTransport | undefined>(undefined);
  useEffect(() => {
    const prev = prevRef.current;
    if (prev && prev !== transport) {
      try {
        prev.close();
      } catch {
        // Idempotent; ignore.
      }
    }
    prevRef.current = transport;
  }, [transport]);

  return transport;
}
