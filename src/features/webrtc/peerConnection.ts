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
 * `iceServers` defaults to {@link DEFAULT_ICE_SERVERS} — public Google STUN only
 * (DMY-47, the $0 alternative to the paid TURN relay of DMY-19). Host candidates
 * cover same-LAN P2P; STUN reflexive candidates extend reach to most NATs WITHOUT
 * any server cost or third-party relay of media. TURN relay (the only thing that
 * also defeats SYMMETRIC NAT, at a price) remains DMY-19 and is deliberately NOT
 * configured here. When STUN is insufficient (symmetric NAT on both ends) ICE may
 * never reach `connected`; that failure is surfaced as user GUIDANCE via the ICE
 * connect timeout (see {@link createIceTimeout} / `useSignaling`), not silently.
 *
 * ## Privacy
 * SDP/ICE are sensitive network metadata. We log only coarse facts (e.g. "offer
 * created"), and any SDP/candidate that does reach the logger goes through the
 * redactor which masks the `sdp`/`candidate` keys. No raw SDP/candidate string
 * is ever logged directly.
 */
import { logger } from '../../services/logger';
import type {
  MediaStreamLike,
  MediaStreamTrackLike,
  RtpSenderLike,
} from './mediaTypes';
import type {
  DataChannel,
  PeerConnection,
  PeerConnectionConfig,
  PeerConnectionEvents,
  PeerConnectionState,
  RtcIceServer,
  SignalingIceCandidate,
  SignalingSdp,
} from './signalingTypes';

/**
 * Default ICE servers: public Google STUN, primary + fallback (DMY-47).
 *
 * `stun.l.google.com:19302` is the primary; `stun1.l.google.com:19302` is a
 * second host so a single-endpoint hiccup does not abort gathering. STUN only
 * discovers the device's server-reflexive (public) address — it never relays
 * media, so this keeps the privacy-first / $0 stance (no TURN, no third party in
 * the media path; the paid TURN relay is DMY-19). Symmetric-NAT-on-both-ends is
 * the case STUN cannot fix; that is handled as guidance via the ICE timeout, not
 * here. Overridable per-call via {@link PeerConnectionConfig.iceServers}.
 */
export const DEFAULT_ICE_SERVERS: readonly RtcIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

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
  /**
   * Open a native data channel (DMY-50). Present on react-native-webrtc's
   * `RTCPeerConnection`; optional here so a minimal mock that does not exercise
   * the alert channel need not implement it.
   */
  createDataChannel?(label: string, options?: unknown): RtcDataChannelLike;
  /**
   * Read a transport stats report (DMY-45). Present on react-native-webrtc's
   * `RTCPeerConnection`; optional here so a minimal mock that does not exercise
   * adaptive bitrate / link quality need not implement it.
   */
  getStats?(): Promise<unknown>;
  close(): void;
  connectionState?: string;
  // Event handler slots (assigned, not addEventListener, to match RN-WebRTC).
  onicecandidate:
    | ((event: { candidate: SignalingIceCandidate | null }) => void)
    | null;
  onconnectionstatechange: ((event?: unknown) => void) | null;
  oniceconnectionstatechange?: ((event?: unknown) => void) | null;
  ontrack: ((event: unknown) => void) | null;
  /**
   * Fired when the PEER opens a data channel (DMY-50). The initiator (parent)
   * uses this to receive the alert channel the responder (baby) created.
   */
  ondatachannel?: ((event: { channel: RtcDataChannelLike }) => void) | null;
  iceConnectionState?: string;
}

/**
 * Minimal structural type of the native `RTCDataChannel` (DMY-50). We touch
 * only `label`, `send`, `close`, `readyState` and the `onopen`/`onmessage`/
 * `onclose` handler slots (assigned, not addEventListener, to match RN-WebRTC).
 */
export interface RtcDataChannelLike {
  readonly label?: string;
  readyState?: string;
  send(data: string): void;
  close(): void;
  onopen?: ((event?: unknown) => void) | null;
  onmessage?: ((event: { data?: unknown }) => void) | null;
  onclose?: ((event?: unknown) => void) | null;
  onerror?: ((event?: unknown) => void) | null;
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
 * Wrap a native {@link RtcDataChannelLike} as our {@link DataChannel} (DMY-50).
 *
 * Exposes a small pub/sub over the native single-slot `onmessage`/`onclose`
 * handlers, normalises the inbound payload to a string, and isolates throwing
 * subscribers — mirroring the PeerConnection wrapper. `send` NEVER throws: a
 * send on a not-yet-open or closed channel is dropped with a coarse log, so the
 * alert pipeline cannot crash on a flaky channel. No payload is ever logged.
 */
export function wrapDataChannel(dc: RtcDataChannelLike): DataChannel {
  const label = dc.label ?? '';
  const messageHandlers = new Set<(payload: string) => void>();
  const closeHandlers = new Set<() => void>();
  let closed = false;

  dc.onmessage = event => {
    const data = event?.data;
    // The native channel may hand us a string or (for binary mode) something
    // else; we only carry small JSON control strings, so coerce non-strings to
    // a string and let the parser reject anything malformed downstream.
    const payload = typeof data === 'string' ? data : String(data ?? '');
    for (const h of messageHandlers) {
      try {
        h(payload);
      } catch {
        // Isolate a misbehaving subscriber.
      }
    }
  };

  dc.onclose = () => {
    for (const h of closeHandlers) {
      try {
        h();
      } catch {
        // Isolate a misbehaving subscriber.
      }
    }
  };

  return {
    label,
    send(payload: string): boolean {
      if (closed || dc.readyState !== 'open') {
        // Not throwing keeps a flaky channel from crashing the alert pipeline.
        logger.debug('datachannel: send skipped (not open)', {
          state: dc.readyState ?? 'unknown',
        });
        return false;
      }
      try {
        dc.send(payload);
        return true;
      } catch {
        logger.warn('datachannel: send failed');
        return false;
      }
    },
    onMessage(handler: (payload: string) => void): () => void {
      messageHandlers.add(handler);
      return () => {
        messageHandlers.delete(handler);
      };
    },
    onClose(handler: () => void): () => void {
      closeHandlers.add(handler);
      return () => {
        closeHandlers.delete(handler);
      };
    },
    isOpen(): boolean {
      return !closed && dc.readyState === 'open';
    },
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      dc.onmessage = null;
      dc.onclose = null;
      messageHandlers.clear();
      closeHandlers.clear();
      try {
        dc.close();
      } catch {
        logger.warn('datachannel: error closing channel');
      }
      logger.info('datachannel: closed');
    },
  };
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
    datachannel: new Set(),
  };

  let remoteDescriptionSet = false;
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

  // The peer (baby/responder) opened a data channel: wrap it and notify the
  // initiator (parent) so it can receive alerts over it (DMY-50).
  pc.ondatachannel = event => {
    const native = event?.channel;
    if (!native) {
      return;
    }
    const channel = wrapDataChannel(native);
    logger.info('datachannel: remote channel received', {
      label: channel.label,
    });
    for (const h of handlers.datachannel) {
      try {
        h(channel);
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
      logger.info('webrtc: offer created');
      return sdp;
    },

    async createAnswer(): Promise<SignalingSdp> {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const sdp = toSignalingSdp(answer, 'answer');
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

    addVideoTrack(
      track: MediaStreamTrackLike,
      stream: MediaStreamLike,
    ): RtpSenderLike | null {
      if (typeof pc.addTrack !== 'function') {
        // A minimal connection without media support: nothing to publish.
        logger.warn('webrtc: addTrack unsupported; video track not published');
        return null;
      }
      try {
        const sender = pc.addTrack(track, stream) as RtpSenderLike | undefined;
        // Coarse, non-PII fact only — no track ids / media content.
        logger.info('webrtc: local video track added (sendonly)');
        return sender ?? null;
      } catch {
        logger.warn('webrtc: failed to add local video track');
        return null;
      }
    },

    createDataChannel(channelLabel: string): DataChannel | null {
      if (typeof pc.createDataChannel !== 'function') {
        // Minimal connection without data-channel support: alerts-over-
        // datachannel are unavailable; callers degrade gracefully.
        logger.warn(
          'datachannel: createDataChannel unsupported; alert channel unavailable',
        );
        return null;
      }
      try {
        // Reliable + ordered (the defaults) — an alert must not be lost or
        // reordered. The channel carries only tiny JSON control messages.
        const native = pc.createDataChannel(channelLabel, {
          ordered: true,
        });
        logger.info('datachannel: local channel created', {
          label: channelLabel,
        });
        return wrapDataChannel(native);
      } catch {
        logger.warn('datachannel: failed to create channel');
        return null;
      }
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

    async getStats(): Promise<unknown> {
      if (closed || typeof pc.getStats !== 'function') {
        // No stats support / torn down: an empty report keeps callers total.
        return new Map();
      }
      try {
        return await pc.getStats();
      } catch {
        logger.warn('webrtc: getStats failed');
        return new Map();
      }
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
      pc.ondatachannel = null;
      handlers.icecandidate.clear();
      handlers.connectionstatechange.clear();
      handlers.track.clear();
      handlers.datachannel.clear();
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
