/**
 * useSignaling — drive the WebRTC signalling handshake from app state (DMY-16).
 *
 * Bridges the {@link SignalingSession} state machine to the global store:
 *   - derives the signalling role from the device `role` (parent → initiator,
 *     baby → responder),
 *   - starts a session when the device is `paired` (a `sessionId` exists) and a
 *     transport is available,
 *   - maps the session status onto the store's `connectionStatus`
 *     (`connecting` / `connected` / `disconnected` / `failed`) — driven by REAL
 *     peer-connection events, never faked,
 *   - tears the session (peer connection + transport) down on stop/unmount.
 *
 * ## Transport injection (honest boundary)
 * The hook does NOT create a real socket transport itself — that is the DMY-16
 * integration point (see `signalingTransport.ts`) and is out of scope. The
 * transport is INJECTED: production will pass a real local socket transport once
 * it exists; tests pass a loopback endpoint; if none is provided the hook stays
 * inert (it never fabricates a connection). This keeps the existing paired
 * screens working unchanged until the socket transport lands.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppStore } from '../../store/useAppStore';
import type { ConnectionStatus } from '../../store/types';
import { createSignalingSession, SignalingSession } from './signalingSession';
import type { SignalingSessionStatus } from './signalingSession';
import type {
  PeerConnectionConfig,
  PeerConnectionFactory,
  SignalingRole,
  SignalingTransport,
} from './signalingTypes';

/** Options for {@link useSignaling}. */
export interface UseSignalingOptions {
  /**
   * The signalling transport. Omit to keep the hook inert (no session is
   * started) — the real local socket transport is the DMY-16 integration point
   * and is injected by production once available; tests inject a loopback
   * endpoint.
   */
  readonly transport?: SignalingTransport;
  /**
   * Peer-connection factory. Defaults (inside the session) to the real
   * react-native-webrtc-backed one; tests inject a mock.
   */
  readonly createPeerConnection?: PeerConnectionFactory;
  /** ICE configuration forwarded to the peer connection. */
  readonly peerConfig?: PeerConnectionConfig;
  /** Called when a remote media track arrives (for the media layer, DMY-17). */
  readonly onRemoteTrack?: (event: unknown) => void;
  /**
   * Auto-start the handshake when paired + a transport is present. Defaults to
   * `true`. Set `false` to drive `start`/`stop` manually.
   */
  readonly autoStart?: boolean;
}

/** Value returned by {@link useSignaling}. */
export interface UseSignalingState {
  /** The high-level session status (independent of the store). */
  readonly status: SignalingSessionStatus;
  /** Whether a session is currently active. */
  readonly isActive: boolean;
  /** Manually start the handshake (no-op if already running / not ready). */
  readonly start: () => void;
  /** Manually stop and tear down the handshake. */
  readonly stop: () => void;
}

/** Map the app `role` onto a signalling role. `null`/baby → responder. */
function roleToSignalingRole(role: 'baby' | 'parent' | null): SignalingRole {
  return role === 'parent' ? 'initiator' : 'responder';
}

/** Map the session status onto the store's connection status. */
function statusToConnectionStatus(
  status: SignalingSessionStatus,
): ConnectionStatus {
  switch (status) {
    case 'connecting':
      return 'connecting';
    case 'connected':
      return 'connected';
    case 'disconnected':
      return 'disconnected';
    case 'failed':
      return 'failed';
    case 'idle':
    default:
      return 'paired';
  }
}

export function useSignaling(
  options: UseSignalingOptions = {},
): UseSignalingState {
  const {
    transport,
    createPeerConnection,
    peerConfig,
    onRemoteTrack,
    autoStart = true,
  } = options;

  const role = useAppStore(s => s.role);
  const pairedSessionId = useAppStore(s => s.pairedSessionId);
  const setConnectionStatus = useAppStore(s => s.setConnectionStatus);

  const [status, setStatus] = useState<SignalingSessionStatus>('idle');
  const [isActive, setIsActive] = useState(false);
  const sessionRef = useRef<SignalingSession | null>(null);

  // All volatile inputs are read through refs so the start/stop callbacks and
  // the auto-start effect are STABLE: a re-render caused by a status update (or
  // a fresh inline `createPeerConnection`/callback prop) must NOT tear the live
  // session down and recreate it. The effect re-runs only on the truly
  // identity-significant keys (transport / sessionId / autoStart).
  const setConnectionStatusRef = useRef(setConnectionStatus);
  setConnectionStatusRef.current = setConnectionStatus;
  const onRemoteTrackRef = useRef(onRemoteTrack);
  onRemoteTrackRef.current = onRemoteTrack;
  const roleRef = useRef(role);
  roleRef.current = role;
  const transportRef = useRef(transport);
  transportRef.current = transport;
  const sessionIdRef = useRef(pairedSessionId);
  sessionIdRef.current = pairedSessionId;
  const createPcRef = useRef(createPeerConnection);
  createPcRef.current = createPeerConnection;
  const peerConfigRef = useRef(peerConfig);
  peerConfigRef.current = peerConfig;

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      session.stop();
      sessionRef.current = null;
    }
    setIsActive(false);
    setStatus('idle');
  }, []);

  const start = useCallback(() => {
    const sessionId = sessionIdRef.current;
    const tx = transportRef.current;
    // Need a paired session id and a transport to do anything real.
    if (!sessionId || !tx) {
      return;
    }
    if (sessionRef.current) {
      return;
    }
    const session = createSignalingSession({
      role: roleToSignalingRole(roleRef.current),
      sessionId,
      transport: tx,
      createPeerConnection: createPcRef.current,
      peerConfig: peerConfigRef.current,
      onStatusChange: next => {
        setStatus(next);
        setConnectionStatusRef.current(statusToConnectionStatus(next));
      },
      onRemoteTrack: event => onRemoteTrackRef.current?.(event),
    });
    sessionRef.current = session;
    setIsActive(true);
    // start() is total (maps any setup failure to `failed` internally); the
    // .catch only keeps the promise from floating for the linter.
    session.start().catch(() => {});
  }, []);

  // Auto-start when ready; tear down on unmount or when the transport/session
  // identity changes. Keyed only on the significant inputs (NOT on volatile
  // callback props) so a status-driven re-render does not churn the session.
  useEffect(() => {
    if (!autoStart) {
      return;
    }
    if (!pairedSessionId || !transport) {
      return;
    }
    start();
    return () => {
      stop();
    };
  }, [autoStart, pairedSessionId, transport, start, stop]);

  return {
    status,
    isActive,
    start,
    stop,
  };
}
