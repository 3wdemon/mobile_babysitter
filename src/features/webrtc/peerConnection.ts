/**
 * peerConnection — a thin, testable wrapper over `RTCPeerConnection` (DMY-16).
 *
 * Wraps react-native-webrtc's `RTCPeerConnection` behind the {@link PeerConnection}
 * contract so the signalling state machine never touches the native API directly
 * and stays unit-testable. The wrapper:
 *   - creates offers/answers and sets the local description,
 *   - applies the remote description and remote ICE candidates,
 *   - forwards `onicecandidate`, `onconnectionstatechange` and `ontrack` as the
 *     small {@link PeerConnectionEvents} set,
 *   - tracks whether a remote description is present (so the session can buffer
 *     early ICE candidates),
 *   - normalises native SDP/ICE objects to the serialisable
 *     {@link SignalingSdp} / {@link SignalingIceCandidate} shapes.
 *
 * ## Design boundary (HONEST)
 * The native `RTCPeerConnection` is injected via {@link RtcPeerConnectionCtor},
 * defaulting to the real one from react-native-webrtc (lazy-required so importing
 * this module under Jest does not pull the native side). Tests pass a mock
 * constructor. The wrapper performs REAL negotiation against whatever ctor it is
 * given; it never synthesises `connected` — that arrives only from a genuine
 * `connectionstatechange`/`iceconnectionstatechange` event.
 *
 * ## STUN/TURN
 * `iceServers` defaults to {@link DEFAULT_ICE_SERVERS} (empty — host candidates
 * suffice for same-LAN P2P). TURN relay for the cellular fallback is DMY-19 and
 * is deliberately NOT configured here.
 *
 * ## Privacy
 * SDP/ICE are sensitive network metadata. We log only coarse facts (e.g. "offer
 * created"), and any SDP/candidate that does reach the logger goes through the
 * redactor which masks the `sdp`/`candidate` keys. No raw SDP/candidate string
 * is ever logged directly.
 */
import { logger } from '../../services/logger';
import type { MediaStreamLike, MediaStreamTrackLike } from './mediaTypes';
import type {
  PeerConnection,
  PeerConnectionConfig,
  PeerConnectionEvents,
  PeerConnectionState,
  RtcIceServer,
  SignalingIceCandidate,
  SignalingSdp,
} from './signalingTypes';

/**
 * Default ICE servers: NONE. For local P2P on the same Wi-Fi, host candidates
 * are sufficient. STUN (for NAT on the same network) can be added later; TURN
 * relay is DMY-19 and is intentionally absent here.
 */
export const DEFAULT_ICE_SERVERS: readonly RtcIceServer[] = [];

/**
 * Minimal structural type of the native `RTCPeerConnection` we depend on. Keeps
 * the wrapper decoupled from react-native-webrtc's full typings and lets tests
 * supply a tiny mock.
 */
export interface RtcPeerConnectionLike {
  createOffer(options?: unknown): Promise<{ type?: string; sdp?: string }>;
  createAnswer(options?: unknown): Promise<{ type?: string; sdp?: string }>;
  setLocalDescription(description: unknown): Promise<void>;
  setRemoteDescription(description: unknown): Promise<void>;
  addIceCandidate(candidate: unknown): Promise<void>;
  /**
   * Publish a local track (with its stream) so it is sent to the peer. Present
   * on react-native-webrtc's `RTCPeerConnection`; optional here so a minimal
   * mock that does not exercise the media path need not implement it.
   */
  addTrack?(track: unknown, stream: unknown): unknown;
  close(): void;
  connectionState?: string;
  // Event handler slots (assigned, not addEventListener, to match RN-WebRTC).
  onicecandidate:
    | ((event: { candidate: SignalingIceCandidate | null }) => void)
    | null;
  onconnectionstatechange: ((event?: unknown) => void) | null;
  oniceconnectionstatechange?: ((event?: unknown) => void) | null;
  ontrack: ((event: unknown) => void) | null;
  iceConnectionState?: string;
}

/** Constructor signature for the (native or mock) peer connection. */
export type RtcPeerConnectionCtor = new (config: {
  iceServers: RtcIceServer[];
}) => RtcPeerConnectionLike;

/**
 * Lazily resolve the real react-native-webrtc `RTCPeerConnection` constructor.
 * Required through `require` so importing this module under Jest / bare JS does
 * not pull the native side; returns `null` if unavailable.
 */
/* istanbul ignore next -- native resolution; tests inject a mock ctor. */
function resolveNativeCtor(): RtcPeerConnectionCtor | null {
  try {
    const mod = require('react-native-webrtc');
    return (mod.RTCPeerConnection ?? null) as RtcPeerConnectionCtor | null;
  } catch {
    logger.warn('webrtc: react-native-webrtc unavailable');
    return null;
  }
}

/**
 * Map a native `connectionState` / `iceConnectionState` string onto our
 * {@link PeerConnectionState}. Unknown values fall back to `'new'`.
 *
 * react-native-webrtc may surface progress via `iceconnectionstatechange`
 * (values: new/checking/connected/completed/disconnected/failed/closed) on
 * platforms where `connectionState` lags, so we normalise both.
 */
export function normalizePeerState(
  raw: string | undefined,
): PeerConnectionState {
  switch (raw) {
    case 'connecting':
    case 'checking':
      return 'connecting';
    case 'connected':
    case 'completed':
      return 'connected';
    case 'disconnected':
      return 'disconnected';
    case 'failed':
      return 'failed';
    case 'closed':
      return 'closed';
    case 'new':
    default:
      return 'new';
  }
}

/**
 * Build a {@link PeerConnection} over a native (or mock) `RTCPeerConnection`.
 *
 * @param config  ICE configuration. Defaults to {@link DEFAULT_ICE_SERVERS}.
 * @param Ctor    The constructor to use. Defaults to the lazily-resolved native
 *                react-native-webrtc constructor; tests inject a mock.
 */
export function createPeerConnection(
  config?: PeerConnectionConfig,
  Ctor: RtcPeerConnectionCtor | null = resolveNativeCtor(),
): PeerConnection {
  if (!Ctor) {
    throw new Error(
      'webrtc: no RTCPeerConnection constructor available (native module missing)',
    );
  }

  const iceServers = [...(config?.iceServers ?? DEFAULT_ICE_SERVERS)];
  const pc = new Ctor({ iceServers });

  // Local event-handler registries. We expose a small pub/sub over the native
  // single-slot handlers so the session can subscribe without clobbering.
  const handlers: {
    [K in keyof PeerConnectionEvents]: Set<PeerConnectionEvents[K]>;
  } = {
    icecandidate: new Set(),
    connectionstatechange: new Set(),
    track: new Set(),
  };

  let remoteDescriptionSet = false;
  let localSdp: string | null = null;
  let lastState: PeerConnectionState = normalizePeerState(pc.connectionState);
  let closed = false;

  function emitState(): void {
    const next = normalizePeerState(
      pc.connectionState ?? pc.iceConnectionState,
    );
    if (next === lastState) {
      return;
    }
    lastState = next;
    // Coarse, non-PII diagnostic.
    logger.info('webrtc: connection state', { state: next });
    for (const h of handlers.connectionstatechange) {
      try {
        h(next);
      } catch {
        // Isolate a misbehaving subscriber.
      }
    }
  }

  pc.onconnectionstatechange = () => emitState();
  // Some platforms only update ICE connection state; mirror it.
  pc.oniceconnectionstatechange = () => emitState();

  pc.onicecandidate = event => {
    const candidate = event?.candidate ?? null;
    for (const h of handlers.icecandidate) {
      try {
        h(candidate);
      } catch {
        // Isolate a misbehaving subscriber.
      }
    }
  };

  pc.ontrack = event => {
    for (const h of handlers.track) {
      try {
        h(event);
      } catch {
        // Isolate a misbehaving subscriber.
      }
    }
  };

  function toSignalingSdp(
    desc: { type?: string; sdp?: string },
    fallbackType: 'offer' | 'answer',
  ): SignalingSdp {
    const type =
      desc.type === 'offer' || desc.type === 'answer'
        ? desc.type
        : fallbackType;
    return { type, sdp: desc.sdp ?? '' };
  }

  return {
    async createOffer(): Promise<SignalingSdp> {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdp = toSignalingSdp(offer, 'offer');
      localSdp = sdp.sdp;
      logger.info('webrtc: offer created');
      return sdp;
    },

    async createAnswer(): Promise<SignalingSdp> {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const sdp = toSignalingSdp(answer, 'answer');
      localSdp = sdp.sdp;
      logger.info('webrtc: answer created');
      return sdp;
    },

    addAudioTrack(track: MediaStreamTrackLike, stream: MediaStreamLike): void {
      if (typeof pc.addTrack !== 'function') {
        // A minimal connection without media support: nothing to publish.
        logger.warn('webrtc: addTrack unsupported; audio track not published');
        return;
      }
      try {
        pc.addTrack(track, stream);
        // Coarse, non-PII fact only — no track ids / media content.
        logger.info('webrtc: local audio track added (sendonly)');
      } catch {
        logger.warn('webrtc: failed to add local audio track');
      }
    },

    getLocalSdp(): string | null {
      return localSdp;
    },

    async setRemoteDescription(description: SignalingSdp): Promise<void> {
      await pc.setRemoteDescription({
        type: description.type,
        sdp: description.sdp,
      });
      remoteDescriptionSet = true;
      logger.info('webrtc: remote description applied', {
        kind: description.type,
      });
    },

    async addIceCandidate(candidate: SignalingIceCandidate): Promise<void> {
      await pc.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      });
    },

    on<K extends keyof PeerConnectionEvents>(
      event: K,
      handler: PeerConnectionEvents[K],
    ): () => void {
      handlers[event].add(handler);
      return () => {
        handlers[event].delete(handler);
      };
    },

    getConnectionState(): PeerConnectionState {
      return lastState;
    },

    hasRemoteDescription(): boolean {
      return remoteDescriptionSet;
    },

    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      // Detach native handlers so a late native callback cannot reach a torn-down
      // session (avoids a leak / use-after-close).
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.ontrack = null;
      handlers.icecandidate.clear();
      handlers.connectionstatechange.clear();
      handlers.track.clear();
      try {
        pc.close();
      } catch {
        logger.warn('webrtc: error closing peer connection');
      }
      lastState = 'closed';
      logger.info('webrtc: peer connection closed');
    },
  };
}
