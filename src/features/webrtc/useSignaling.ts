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
import { t } from '../../services/i18n';
import {
  createIceTimeout,
  type IceTimeout,
  type IceTimeoutOptions,
} from './iceTimeout';
import {
  createReconnectController,
  type ReconnectController,
  type ReconnectPolicy,
  type SetTimer,
  type ClearTimer,
  type Rng,
} from './reconnectPolicy';
import { createSignalingSession, SignalingSession } from './signalingSession';
import type { SignalingSessionStatus } from './signalingSession';
import type {
  PeerConnection,
  PeerConnectionConfig,
  PeerConnectionFactory,
  PeerConnectionState,
  SignalingRole,
  SignalingSdp,
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
   * Called with the local SDP right after it is created (DMY-18). The audio
   * layer uses it to assert the DTLS-SRTP encrypted-media profile.
   */
  readonly onLocalDescription?: (description: SignalingSdp) => void;
  /**
   * Called once the peer connection exists, before any offer/answer (DMY-18).
   * The audio layer uses it to publish the baby-unit's local audio track.
   * Awaited inside the session so capture completes before negotiation.
   */
  readonly onPeerConnection?: (pc: PeerConnection) => void | Promise<void>;
  /**
   * Auto-start the handshake when paired + a transport is present. Defaults to
   * `true`. Set `false` to drive `start`/`stop` manually.
   */
  readonly autoStart?: boolean;
  /**
   * Injected timer primitives for the ICE connect-timeout (DMY-47). Omit in
   * production (the controller defaults to the host `setTimeout`/`clearTimeout`);
   * tests pass a fake scheduler so the timeout fires deterministically.
   */
  readonly iceTimer?: Pick<IceTimeoutOptions, 'setTimer' | 'clearTimer'> & {
    /** Override the connect window; defaults to `ICE_CONNECT_TIMEOUT_MS`. */
    readonly timeoutMs?: number;
  };
  /**
   * Auto-reconnect with exponential backoff on an UNCLEAN drop (DMY-61).
   * Default `true`. When the live peer connection reports `disconnected`/`failed`
   * after having been `connected`, the hook re-runs its connect path on a backoff
   * schedule up to a cap, then surfaces a permanent failure with a manual
   * {@link UseSignalingState.retry}. A local {@link UseSignalingState.stop}
   * suppresses reconnect. Set `false` to disable auto-reconnect entirely.
   */
  readonly autoReconnect?: boolean;
  /** Override the backoff policy (base/cap/maxAttempts/jitter). DMY-61. */
  readonly reconnectPolicy?: ReconnectPolicy;
  /**
   * Injected timer + RNG primitives for the reconnect backoff (DMY-61). Omit in
   * production (defaults to host `setTimeout`/`clearTimeout`/`Math.random`);
   * tests pass a fake scheduler + fixed RNG so backoff fires deterministically.
   */
  readonly reconnectTimer?: {
    readonly setTimer?: SetTimer;
    readonly clearTimer?: ClearTimer;
    readonly rng?: Rng;
  };
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
  /**
   * `true` when ICE stayed in `connecting` past the connect window (DMY-47) —
   * STUN-only traversal likely failed (e.g. symmetric NAT). Reset to `false`
   * once `connected` arrives or the session is stopped. The UI shows
   * {@link UseSignalingState.guidanceMessage} while this is set.
   */
  readonly iceTimedOut: boolean;
  /**
   * Localised guidance to show while {@link UseSignalingState.iceTimedOut}, or
   * `null` otherwise ("check Wi-Fi / restart connection").
   */
  readonly guidanceMessage: string | null;
  /**
   * `true` while an auto-reconnect attempt is scheduled / in flight after an
   * unclean drop (DMY-61). The UI shows a "Reconnecting…" banner while set.
   */
  readonly reconnecting: boolean;
  /**
   * 1-based number of the reconnect attempt currently in flight (0 when not
   * reconnecting). Drives the "Reconnecting… (attempt N)" copy.
   */
  readonly reconnectAttempt: number;
  /**
   * `true` once the backoff exhausted all attempts without reconnecting: the
   * retry loop has STOPPED (no infinite loop) and the UI offers a manual
   * {@link UseSignalingState.retry}.
   */
  readonly reconnectFailed: boolean;
  /**
   * Manually re-attempt the connection after a permanent reconnect failure
   * (the banner's "Retry" button). Resets the backoff and starts a fresh
   * attempt; no-op while a session is healthy or a retry is already pending.
   */
  readonly retry: () => void;
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

/**
 * Map the session status onto the {@link PeerConnectionState} the ICE timeout
 * controller (DMY-47) understands. `idle` carries no obligation → `new`.
 */
function statusToPeerState(
  status: SignalingSessionStatus,
): PeerConnectionState {
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
      return 'new';
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
    onLocalDescription,
    onPeerConnection,
    autoStart = true,
    iceTimer,
    autoReconnect = true,
    reconnectPolicy,
    reconnectTimer,
  } = options;

  const role = useAppStore(s => s.role);
  const pairedSessionId = useAppStore(s => s.pairedSessionId);
  const setConnectionStatus = useAppStore(s => s.setConnectionStatus);

  const [status, setStatus] = useState<SignalingSessionStatus>('idle');
  const [isActive, setIsActive] = useState(false);
  const [iceTimedOut, setIceTimedOut] = useState(false);
  // Reconnect UI state (DMY-61), mirrored from the reconnect controller snapshot.
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const sessionRef = useRef<SignalingSession | null>(null);
  // The ICE connect-timeout controller for the live session (DMY-47). Created in
  // `start`, driven by the session status callback, cancelled in `stop`.
  const iceTimeoutRef = useRef<IceTimeout | null>(null);
  // The reconnect/backoff controller for the live session (DMY-61). Created in
  // `start`, driven by the session status callback, cancelled in `stop`.
  const reconnectRef = useRef<ReconnectController | null>(null);
  // Set while a local stop()/unmount teardown is in progress, so the session's
  // own `disconnected`/`failed` status update during teardown does NOT trigger a
  // reconnect. This is the honest clean-vs-unclean boundary at this layer: a
  // user-initiated stop is suppressed; a remote `bye` is NOT yet distinguishable
  // from an unclean drop (DMY-45 wires `bye` teardown — until then a remote
  // hangup will read as `disconnected` and is treated as reconnectable).
  const tearingDownRef = useRef(false);
  // Set once a remote `bye` arrives (DMY-45): the in-flight `disconnected`
  // status that follows is a CLEAN remote close, so the status callback must not
  // arm a reconnect. Distinct from `tearingDownRef` (a LOCAL stop/unmount).
  const cleanRemoteCloseRef = useRef(false);
  // Track mount so the timeout callback never setState after unmount.
  const mountedRef = useRef(true);
  const iceTimerRef = useRef(iceTimer);
  iceTimerRef.current = iceTimer;
  const autoReconnectRef = useRef(autoReconnect);
  autoReconnectRef.current = autoReconnect;
  const reconnectPolicyRef = useRef(reconnectPolicy);
  reconnectPolicyRef.current = reconnectPolicy;
  const reconnectTimerRef = useRef(reconnectTimer);
  reconnectTimerRef.current = reconnectTimer;

  // All volatile inputs are read through refs so the start/stop callbacks and
  // the auto-start effect are STABLE: a re-render caused by a status update (or
  // a fresh inline `createPeerConnection`/callback prop) must NOT tear the live
  // session down and recreate it. The effect re-runs only on the truly
  // identity-significant keys (transport / sessionId / autoStart).
  const setConnectionStatusRef = useRef(setConnectionStatus);
  setConnectionStatusRef.current = setConnectionStatus;
  const onRemoteTrackRef = useRef(onRemoteTrack);
  onRemoteTrackRef.current = onRemoteTrack;
  const onLocalDescriptionRef = useRef(onLocalDescription);
  onLocalDescriptionRef.current = onLocalDescription;
  const onPeerConnectionRef = useRef(onPeerConnection);
  onPeerConnectionRef.current = onPeerConnection;
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

  // Mirror the reconnect controller snapshot into React state for the UI.
  const syncReconnectState = useCallback(() => {
    const ctrl = reconnectRef.current;
    if (!ctrl || !mountedRef.current) {
      return;
    }
    const snap = ctrl.snapshot();
    setReconnecting(snap.reconnecting);
    setReconnectAttempt(snap.attempt);
    setReconnectFailed(snap.failedPermanently);
  }, []);

  // Create + start a fresh SignalingSession for the CURRENT session id/transport
  // and wire its status into the store, the ICE timeout and the reconnect
  // controller. Reused by `start` (first attempt) and by the reconnect
  // controller's `attemptReconnect` (re-run of the connect path on a backoff
  // tick). The caller is responsible for having torn down any prior session.
  const launchSession = useCallback(() => {
    const sessionId = sessionIdRef.current;
    const tx = transportRef.current;
    if (!sessionId || !tx) {
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
        const peerState = statusToPeerState(next);
        // Drive the ICE timeout: connecting arms; connected (or a terminal
        // state) cancels — this is what prevents false guidance when the link
        // comes up just before the deadline.
        iceTimeoutRef.current?.onState(peerState);
        // Drive the reconnect controller from the same REAL status stream
        // (DMY-61) — UNLESS a local teardown is in progress (stop()/unmount) OR
        // the peer cleanly hung up (`bye`, DMY-45), neither of which is an
        // unclean drop worth reconnecting.
        if (!tearingDownRef.current && !cleanRemoteCloseRef.current) {
          reconnectRef.current?.onState(peerState);
          syncReconnectState();
        }
        if (next === 'connected') {
          // Clear any guidance the timeout may have surfaced earlier in a churn.
          setIceTimedOut(false);
        }
      },
      onBye: () => {
        // A clean remote hangup (DMY-45): suppress auto-reconnect (do not chase
        // a peer that left). `cleanRemoteCloseRef` makes the `disconnected`
        // status that follows non-reconnectable; cancel the controller so no
        // backoff tick fires; then drop to inactive so the media hooks release
        // the camera/mic (no capture leak). The session closes the pc+transport.
        cleanRemoteCloseRef.current = true;
        reconnectRef.current?.cancel();
        reconnectRef.current = null;
        iceTimeoutRef.current?.cancel();
        iceTimeoutRef.current = null;
        sessionRef.current = null;
        if (mountedRef.current) {
          setIsActive(false);
          setReconnecting(false);
          setReconnectAttempt(0);
          setReconnectFailed(false);
        }
      },
      onRemoteTrack: event => onRemoteTrackRef.current?.(event),
      onLocalDescription: (description: SignalingSdp) =>
        onLocalDescriptionRef.current?.(description),
      onPeerConnection: (pc: PeerConnection) =>
        onPeerConnectionRef.current?.(pc),
    });
    sessionRef.current = session;
    setIsActive(true);
    // start() is total (maps any setup failure to `failed` internally); the
    // .catch only keeps the promise from floating for the linter.
    session.start().catch(() => {});
  }, [syncReconnectState]);

  // Tear down the live session WITHOUT clearing reconnect state — used between
  // reconnect attempts so the next attempt re-establishes a fresh session. The
  // `tearingDownRef` guard suppresses the dying session's `disconnected` status
  // from being mis-read as a new unclean drop.
  const teardownSession = useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      tearingDownRef.current = true;
      try {
        session.stop();
      } finally {
        tearingDownRef.current = false;
      }
      sessionRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    // Cancel reconnect FIRST so the session's teardown status updates cannot
    // schedule a fresh attempt: a local stop is a CLEAN teardown.
    reconnectRef.current?.cancel();
    reconnectRef.current = null;
    cleanRemoteCloseRef.current = false;
    teardownSession();
    // Cancel any pending ICE timeout so a torn-down session never fires guidance.
    iceTimeoutRef.current?.cancel();
    iceTimeoutRef.current = null;
    setIsActive(false);
    setStatus('idle');
    setIceTimedOut(false);
    setReconnecting(false);
    setReconnectAttempt(0);
    setReconnectFailed(false);
  }, [teardownSession]);

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
    // Fresh session: clear any clean-close marker from a previous one.
    cleanRemoteCloseRef.current = false;
    // Arm the ICE connect-timeout for this session (DMY-47). It is driven by the
    // session status callback (connecting arms; connected/terminal cancels) and
    // fires guidance once if `connected` never arrives in time.
    const cfg = iceTimerRef.current;
    const iceTimeout = createIceTimeout({
      ...(cfg?.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
      ...(cfg?.setTimer ? { setTimer: cfg.setTimer } : {}),
      ...(cfg?.clearTimer ? { clearTimer: cfg.clearTimer } : {}),
      onTimeout: () => {
        // Guard against a stale fire after unmount/stop (no setState-after-unmount).
        if (mountedRef.current && sessionRef.current) {
          setIceTimedOut(true);
        }
      },
    });
    iceTimeoutRef.current = iceTimeout;
    setIceTimedOut(false);

    // Build the reconnect/backoff controller for this session lifetime (DMY-61).
    // It owns ONLY the retry timing: on an unclean drop it tears the dead session
    // down (no duplicate teardown logic — it calls the same stop+launch path) and
    // re-runs the connect path on a backoff schedule, up to the attempt cap.
    if (autoReconnectRef.current) {
      const rcfg = reconnectTimerRef.current;
      const pol = reconnectPolicyRef.current;
      reconnectRef.current = createReconnectController({
        ...(pol ? { policy: pol } : {}),
        ...(rcfg?.setTimer ? { setTimer: rcfg.setTimer } : {}),
        ...(rcfg?.clearTimer ? { clearTimer: rcfg.clearTimer } : {}),
        ...(rcfg?.rng ? { rng: rcfg.rng } : {}),
        attemptReconnect: () => {
          if (!mountedRef.current) {
            return;
          }
          // Re-run the connect path: drop the dead session, launch a fresh one.
          teardownSession();
          launchSession();
          syncReconnectState();
        },
        onExhausted: () => {
          // Max attempts reached: STOP retrying (no infinite loop). Surface the
          // permanent failure so the UI offers a manual retry.
          if (mountedRef.current) {
            syncReconnectState();
          }
        },
      });
    }
    setReconnecting(false);
    setReconnectAttempt(0);
    setReconnectFailed(false);

    launchSession();
  }, [launchSession, teardownSession, syncReconnectState]);

  // Manual retry after a permanent reconnect failure (the banner's button).
  const retry = useCallback(() => {
    const ctrl = reconnectRef.current;
    if (!ctrl) {
      return;
    }
    ctrl.retry();
    syncReconnectState();
  }, [syncReconnectState]);

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

  // Mount-lifetime guard: ensure no ICE timeout fires (and no setState runs)
  // after unmount, even in manual mode where the auto-start effect's cleanup
  // does not run. Idempotent with `stop`'s own cancel.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      iceTimeoutRef.current?.cancel();
      iceTimeoutRef.current = null;
      // Cancel any pending reconnect so no backoff timer fires (and no setState
      // runs) after unmount, even in manual mode where the auto-start effect's
      // cleanup does not run. Idempotent with `stop`'s own cancel.
      reconnectRef.current?.cancel();
      reconnectRef.current = null;
    };
  }, []);

  return {
    status,
    isActive,
    start,
    stop,
    iceTimedOut,
    guidanceMessage: iceTimedOut ? t('webrtc.iceTimeout.guidance') : null,
    reconnecting,
    reconnectAttempt,
    reconnectFailed,
    retry,
  };
}
