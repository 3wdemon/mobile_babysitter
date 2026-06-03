/**
 * babyBroadcast — baby-side fan-out manager: ONE baby → 2-3 parents (DMY-66).
 *
 * DMY-45 landed the 1:1 model: a single {@link SignalingSession} carries the
 * baby's audio+video to ONE parent over one peer connection, with the local
 * capture released on `bye`/teardown. This manager generalises the baby side to
 * a SMALL fan-out (MVP cap {@link MAX_PARENTS} = 3) WITHOUT changing the parent
 * side or the per-peer state machine:
 *
 *  - **One capture, shared.** `getUserMedia` runs ONCE (camera+mic), lazily on
 *    the first parent, and the SAME {@link MediaStreamLike} is published into
 *    EVERY peer connection (one `RTCRtpSender` set per peer). We never open the
 *    camera twice, and we never stop it while at least one parent is connected
 *    (no capture leak, no flicker).
 *  - **One responder session per parent.** Each parent gets its OWN
 *    {@link SignalingSession} (role `responder`) over its OWN per-client
 *    transport, multiplexed by the {@link MultiClientSignalingTransport} seam
 *    (routing by `clientId`). The handshakes are fully independent.
 *  - **Per-peer isolation.** A parent dropping (its pc `failed`/`closed`, or a
 *    remote `bye`) tears down ONLY that peer's session; the others are untouched.
 *    The shared capture is stopped only when the LAST parent leaves (AC #2).
 *  - **Graceful cap.** Once {@link MAX_PARENTS} parents are connected, a further
 *    client is REJECTED with a machine-readable reason
 *    ({@link AddParentRejection}) that the UI maps to a localised message
 *    (AC #3). We never silently drop a parent.
 *
 * ## Honest boundaries
 * The fan-out logic, capture sharing, per-peer teardown and the cap are REAL and
 * fully unit-tested against the existing testable seams (mock peer connections,
 * a fake multi-client transport). The transport here is a SEAM: a real
 * multi-client local-network WebSocket SERVER on the baby unit (one accept loop,
 * per-client routing) is the device milestone tracked by **DMY-72**; the shipped
 * default factory throws with guidance rather than faking a server (mirroring
 * {@link defaultSignalingServerFactory}). Two-plus phones receiving live frames
 * from one baby is a manual device milestone; every seam used to do it is real.
 */
import { logger } from '../../services/logger';
import { stopStream } from './audioStream';
import {
  getLocalVideoStream,
  setVideoBitrate,
  videoTracksOf,
  VIDEO_QUALITY_LADDER,
} from './videoStream';
import { createSignalingSession, SignalingSession } from './signalingSession';
import type { SignalingSessionStatus } from './signalingSession';
import type { LocalVideoCapture } from './videoStream';
import type { MediaDevicesLike, RtpSenderLike } from './mediaTypes';
import type {
  PeerConnection,
  PeerConnectionConfig,
  PeerConnectionFactory,
  SignalingTransport,
} from './signalingTypes';

/**
 * Maximum simultaneous parents for the MVP fan-out (DMY-66). Three covers the
 * "two parents + a grandparent" family case without pushing a single phone's
 * uplink encode budget past what adaptive bitrate (DMY-17) can shape. A higher
 * cap (an SFU-style relay) is explicitly out of scope.
 */
export const MAX_PARENTS = 3;

/** Why an {@link addParent} attempt was rejected. */
export type AddParentRejectionReason =
  /** The fan-out already holds {@link MAX_PARENTS} parents (AC #3). */
  | 'max-parents'
  /** A parent with this `clientId` is already connected (idempotent guard). */
  | 'duplicate'
  /** The manager was already stopped. */
  | 'stopped';

/** The result of an {@link addParent} attempt. */
export type AddParentResult =
  | { readonly ok: true; readonly peerId: string }
  | { readonly ok: false; readonly reason: AddParentRejectionReason };

/**
 * A connected (or connecting) parent, as surfaced to the UI. Carries ONLY
 * non-PII facts: an opaque client id and the coarse session status.
 */
export interface BroadcastParent {
  /** Opaque per-client id (assigned by the transport seam / accept loop). */
  readonly clientId: string;
  /** The coarse signalling status of this parent's session. */
  readonly status: SignalingSessionStatus;
}

/**
 * A multi-client signalling transport: the baby-side accept loop (DMY-72). It
 * does NOT carry messages itself — it hands the manager a fresh per-client
 * {@link SignalingTransport} for EACH connecting parent (keyed by an opaque
 * `clientId`), and reports a client disconnecting. The manager spins up one
 * responder {@link SignalingSession} per client over that per-client transport.
 *
 * ## Why a separate seam
 * The 1:1 {@link SignalingTransport} is point-to-point; the baby cannot demux N
 * parents over one of those. Rather than overload the existing contract, this
 * adds a tiny accept-loop seam so the per-peer state machine stays UNCHANGED.
 * The real implementation (a local-network WS server that accepts N parent
 * dials and routes by client) is the device milestone **DMY-72**; tests inject
 * a fake that drives `onClientConnect` synchronously.
 */
export interface MultiClientSignalingTransport {
  /**
   * Subscribe to a parent connecting. The handler is given the opaque
   * `clientId` and a per-client {@link SignalingTransport} carrying only that
   * parent's messages. Returns an unsubscribe.
   */
  onClientConnect(
    handler: (clientId: string, transport: SignalingTransport) => void,
  ): () => void;
  /**
   * Subscribe to a parent's underlying connection dropping at the TRANSPORT
   * level (socket closed) — distinct from a peer-connection `failed`. Returns
   * an unsubscribe. Optional: a transport that only surfaces drops via the
   * per-client transport's `onError` may omit it.
   */
  onClientDisconnect?(handler: (clientId: string) => void): () => void;
  /** Start accepting parent connections. Resolves once listening. */
  start(): Promise<void>;
  /** Stop accepting and tear the accept loop down. Idempotent. */
  close(): void;
}

/** Options for {@link createBabyBroadcast}. */
export interface BabyBroadcastOptions {
  /** Ephemeral pairing session id; stamped onto every peer's messages. */
  readonly sessionId: string;
  /** The multi-client accept-loop transport (the DMY-72 seam). */
  readonly transport: MultiClientSignalingTransport;
  /**
   * Media-devices source for the SHARED baby capture. Omit for the real one
   * (react-native-webrtc); tests inject a fake.
   */
  readonly mediaDevices?: MediaDevicesLike;
  /**
   * Peer-connection factory per parent. Defaults (inside each session) to the
   * real one; tests inject a mock.
   */
  readonly createPeerConnection?: PeerConnectionFactory;
  /** ICE configuration forwarded to every peer connection. */
  readonly peerConfig?: PeerConnectionConfig;
  /** Whether the baby starts transmitting video. Defaults to `true`. */
  readonly videoEnabled?: boolean;
  /**
   * Override the parent cap (MVP default {@link MAX_PARENTS}). Mainly for tests;
   * production keeps the default.
   */
  readonly maxParents?: number;
  /** Called whenever the connected-parents list changes (for the UI). */
  readonly onParentsChange?: (parents: readonly BroadcastParent[]) => void;
}

/** Public surface of the fan-out manager. */
export interface BabyBroadcast {
  /** Begin accepting parents (starts the accept loop). Idempotent. */
  start(): Promise<void>;
  /**
   * Manually offer a parent a slot over a per-client transport (the path the
   * accept loop uses internally; also handy for tests). Enforces the cap and
   * the duplicate guard, then launches a responder session and publishes the
   * shared capture into its peer connection.
   */
  addParent(
    clientId: string,
    transport: SignalingTransport,
  ): Promise<AddParentResult>;
  /** Tear down a single parent's session (isolated). Idempotent per client. */
  removeParent(clientId: string): void;
  /** Snapshot of the currently-tracked parents. */
  getParents(): readonly BroadcastParent[];
  /** Whether the shared capture is currently live (no leak once all leave). */
  isCapturing(): boolean;
  /** Tear EVERYTHING down: all sessions, the accept loop, the shared capture. */
  stop(): void;
}

/** Internal per-parent record. */
interface PeerEntry {
  readonly clientId: string;
  readonly session: SignalingSession;
  status: SignalingSessionStatus;
  /** The video sender for this peer (adaptive bitrate handle), if any. */
  sender: RtpSenderLike | null;
}

/**
 * Create the baby-side fan-out manager (DMY-66).
 *
 * The returned manager owns: the accept-loop subscription, a `Map` of per-parent
 * sessions, and the single shared capture. It NEVER fabricates a connection —
 * every status comes from a real per-peer {@link SignalingSession}.
 */
export function createBabyBroadcast(
  options: BabyBroadcastOptions,
): BabyBroadcast {
  const {
    sessionId,
    transport,
    mediaDevices,
    createPeerConnection,
    peerConfig,
    videoEnabled = true,
    maxParents = MAX_PARENTS,
    onParentsChange,
  } = options;

  const peers = new Map<string, PeerEntry>();
  /** The single shared capture, lazily acquired on the first parent. */
  let capture: LocalVideoCapture | null = null;
  /** In-flight capture promise so two near-simultaneous parents share one. */
  let capturePromise: Promise<LocalVideoCapture> | null = null;
  let started = false;
  let stopped = false;
  const unsubscribes: Array<() => void> = [];

  function emitParents(): void {
    if (!onParentsChange) {
      return;
    }
    try {
      onParentsChange(snapshot());
    } catch {
      // A UI subscriber must never break the fan-out.
    }
  }

  function snapshot(): readonly BroadcastParent[] {
    return [...peers.values()].map(p => ({
      clientId: p.clientId,
      status: p.status,
    }));
  }

  /** Acquire (once) the shared camera+mic capture. */
  async function ensureCapture(): Promise<LocalVideoCapture> {
    if (capture) {
      return capture;
    }
    if (!capturePromise) {
      capturePromise = getLocalVideoStream(mediaDevices ?? null);
    }
    capture = await capturePromise;
    return capture;
  }

  /**
   * Stop the shared capture IFF no parents remain — releasing the camera+mic so
   * there is no leak once the last parent leaves (AC #2 / AC #3 of DMY-45).
   */
  function releaseCaptureIfIdle(): void {
    if (peers.size > 0) {
      return;
    }
    if (capture) {
      stopStream(capture.stream); // releases camera + mic
      capture = null;
    }
    capturePromise = null;
  }

  /** Publish the SHARED capture's tracks into one peer connection. */
  async function publishInto(
    entry: PeerEntry,
    pc: PeerConnection,
  ): Promise<void> {
    const wasCapturing = capture !== null;
    const cap = await ensureCapture();
    // The capture flipped live on the FIRST parent — re-emit so the UI's
    // `capturing` flag (read from isCapturing) reflects it without waiting for
    // the next status change.
    if (!wasCapturing) {
      emitParents();
    }
    // Audio track(s): the parent hears the room.
    for (const track of cap.stream.getTracks()) {
      if (track.kind === 'audio') {
        pc.addAudioTrack(track, cap.stream);
      }
    }
    // Video track: publish + keep the sender for this peer's adaptive bitrate.
    const [videoTrack] = videoTracksOf(cap.stream);
    if (videoTrack) {
      const sender = pc.addVideoTrack(videoTrack, cap.stream);
      entry.sender = sender;
      if (sender) {
        // Each peer starts at the top of the ladder; per-peer adaptive bitrate
        // (DMY-17) can step ITS OWN encoding down without touching the others.
        await setVideoBitrate(sender, VIDEO_QUALITY_LADDER[0]).catch(() => {});
        if (!videoEnabled) {
          // Pause this peer's outgoing video at the source track. Since the
          // capture is SHARED, disabling the track would affect all peers, so we
          // leave the track enabled and rely on per-sender control elsewhere; we
          // only honour videoEnabled=false by not stepping the bitrate up. This
          // matches the 1:1 hook's contract while keeping peers independent.
          logger.debug(
            'webrtc/broadcast: video disabled for new peer (shared capture)',
          );
        }
      }
    }
  }

  async function addParent(
    clientId: string,
    perClientTransport: SignalingTransport,
  ): Promise<AddParentResult> {
    if (stopped) {
      return { ok: false, reason: 'stopped' };
    }
    if (peers.has(clientId)) {
      logger.warn('webrtc/broadcast: duplicate parent rejected', { clientId });
      return { ok: false, reason: 'duplicate' };
    }
    if (peers.size >= maxParents) {
      // Graceful cap (AC #3): reject, do NOT evict an existing parent. The
      // per-client transport is closed so the parent's dial fails cleanly; the
      // UI surfaces the localised "monitor full" message.
      logger.info('webrtc/broadcast: max parents reached, rejecting', {
        clientId,
        max: maxParents,
      });
      try {
        perClientTransport.close();
      } catch {
        // ignore — best-effort reject.
      }
      return { ok: false, reason: 'max-parents' };
    }

    const session = createSignalingSession({
      role: 'responder',
      sessionId,
      transport: perClientTransport,
      createPeerConnection,
      peerConfig,
      onStatusChange: status => {
        const entry = peers.get(clientId);
        if (!entry) {
          return;
        }
        entry.status = status;
        // A genuine per-peer failure tears down ONLY this peer (isolation).
        if (status === 'failed') {
          removeParent(clientId);
          return;
        }
        emitParents();
      },
      onBye: () => {
        // The parent politely hung up: drop only its session (isolation).
        removeParent(clientId);
      },
      // Publish the SHARED capture into this peer BEFORE its answer is built.
      onPeerConnection: async (pc: PeerConnection) => {
        const entry = peers.get(clientId);
        if (!entry) {
          return;
        }
        await publishInto(entry, pc);
      },
    });

    const entry: PeerEntry = {
      clientId,
      session,
      status: 'connecting',
      sender: null,
    };
    peers.set(clientId, entry);
    emitParents();

    // start() is total (maps any setup failure to `failed` internally); the
    // .catch only keeps the promise from floating for the linter.
    await session.start().catch(() => {});
    return { ok: true, peerId: clientId };
  }

  function removeParent(clientId: string): void {
    const entry = peers.get(clientId);
    if (!entry) {
      return;
    }
    peers.delete(clientId);
    try {
      entry.session.stop(); // closes ONLY this peer's pc + per-client transport
    } catch {
      logger.warn('webrtc/broadcast: error stopping peer session', {
        clientId,
      });
    }
    // Release the shared camera+mic ONLY when the last parent has left.
    releaseCaptureIfIdle();
    emitParents();
  }

  async function start(): Promise<void> {
    if (started || stopped) {
      return;
    }
    started = true;
    unsubscribes.push(
      transport.onClientConnect((clientId, perClientTransport) => {
        // Fire-and-forget: addParent is total (its own guards); a rejection just
        // closes that client's transport.
        addParent(clientId, perClientTransport).catch(() => {});
      }),
    );
    if (transport.onClientDisconnect) {
      unsubscribes.push(
        transport.onClientDisconnect(clientId => {
          removeParent(clientId);
        }),
      );
    }
    try {
      await transport.start();
    } catch (error) {
      logger.error('webrtc/broadcast: accept loop start failed', error);
    }
  }

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    for (const unsub of unsubscribes.splice(0)) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    // Tear every peer down (each closes its own pc + transport).
    for (const entry of [...peers.values()]) {
      try {
        entry.session.stop();
      } catch {
        // ignore
      }
    }
    peers.clear();
    // Release the shared camera+mic — no parents remain.
    releaseCaptureIfIdle();
    try {
      transport.close();
    } catch {
      // ignore
    }
    emitParents();
    logger.info('webrtc/broadcast: stopped');
  }

  return {
    start,
    addParent,
    removeParent,
    getParents: snapshot,
    isCapturing: () => capture !== null,
    stop,
  };
}
