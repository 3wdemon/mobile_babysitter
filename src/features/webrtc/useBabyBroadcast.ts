/**
 * useBabyBroadcast — drive the baby-side fan-out manager from a screen (DMY-66).
 *
 * Wraps {@link createBabyBroadcast} for the {@link BabyScreen}: it owns the
 * manager's lifetime (start on a paired session + transport, stop on
 * unmount/identity change), mirrors the connected-parents list into React state
 * for the UI, and tracks whether the parent cap was hit so the screen can show a
 * localised "monitor full" notice (AC #3).
 *
 * ## Honest boundary (mirrors useSignaling / useMediaSession)
 * The MULTI-CLIENT transport is INJECTED: production passes a real local-network
 * accept loop once it exists ({@link MultiClientSignalingTransport}, device
 * milestone **DMY-72**); tests pass a fake that drives `onClientConnect`
 * synchronously. With no transport the hook stays inert — it NEVER fabricates a
 * connected parent.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppStore } from '../../store/useAppStore';
import {
  createBabyBroadcast,
  MAX_PARENTS,
  type BabyBroadcast,
  type BroadcastParent,
  type MultiClientSignalingTransport,
} from './babyBroadcast';
import type { AudioPlayback } from './audioPlayback';
import type { MediaDevicesLike } from './mediaTypes';
import type {
  PeerConnectionConfig,
  PeerConnectionFactory,
} from './signalingTypes';

/** Options for {@link useBabyBroadcast}. */
export interface UseBabyBroadcastOptions {
  /**
   * The multi-client accept-loop transport (DMY-72 seam). Omit to keep the hook
   * inert; tests inject a fake.
   */
  readonly transport?: MultiClientSignalingTransport;
  /** Media-devices source for the SHARED capture. Omit for the real one. */
  readonly mediaDevices?: MediaDevicesLike;
  /** Peer-connection factory per parent. Defaults inside each session. */
  readonly createPeerConnection?: PeerConnectionFactory;
  /** ICE configuration forwarded to every peer connection. */
  readonly peerConfig?: PeerConnectionConfig;
  /** Override the parent cap (mainly for tests). */
  readonly maxParents?: number;
  /**
   * Two-way talk playback (parent→baby, DMY-76). Forwarded to the manager so a
   * parent's incoming push-to-talk audio is played out of the baby speaker. Omit
   * for the safe no-op (react-native-webrtc still renders a live remote track on
   * the default output in a real build); tests inject a fake.
   */
  readonly talkbackPlayback?: AudioPlayback;
}

/** Value returned by {@link useBabyBroadcast}. */
export interface UseBabyBroadcastState {
  /** The currently-tracked parents (id + coarse status). */
  readonly parents: readonly BroadcastParent[];
  /** Count of parents whose session is `connected`. */
  readonly connectedCount: number;
  /** The cap (for "N / MAX" copy). */
  readonly maxParents: number;
  /**
   * `true` while the tracked parents are at the cap; clears the instant the
   * list drops below it (e.g. a parent leaves). Drives the localised "monitor
   * full" message on the screen (AC #3).
   */
  readonly capReached: boolean;
  /** Whether the shared capture is live (diagnostics; no leak once all leave). */
  readonly capturing: boolean;
}

export function useBabyBroadcast(
  options: UseBabyBroadcastOptions = {},
): UseBabyBroadcastState {
  const {
    transport,
    mediaDevices,
    createPeerConnection,
    peerConfig,
    maxParents = MAX_PARENTS,
    talkbackPlayback,
  } = options;

  const pairedSessionId = useAppStore(s => s.pairedSessionId);

  const [parents, setParents] = useState<readonly BroadcastParent[]>([]);
  const [capReached, setCapReached] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const managerRef = useRef<BabyBroadcast | null>(null);
  const mountedRef = useRef(true);

  // Read volatile inputs through refs so the start effect stays keyed only on
  // the identity-significant inputs (sessionId / transport) — a re-render from a
  // parents-list update must NOT churn the manager.
  const mediaDevicesRef = useRef(mediaDevices);
  mediaDevicesRef.current = mediaDevices;
  const createPcRef = useRef(createPeerConnection);
  createPcRef.current = createPeerConnection;
  const peerConfigRef = useRef(peerConfig);
  peerConfigRef.current = peerConfig;
  const maxParentsRef = useRef(maxParents);
  maxParentsRef.current = maxParents;
  const talkbackPlaybackRef = useRef(talkbackPlayback);
  talkbackPlaybackRef.current = talkbackPlayback;

  const sync = useCallback((next: readonly BroadcastParent[]) => {
    if (!mountedRef.current) {
      return;
    }
    setParents(next);
    setCapturing(managerRef.current?.isCapturing() ?? false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!pairedSessionId || !transport) {
      return;
    }
    const manager = createBabyBroadcast({
      sessionId: pairedSessionId,
      transport,
      ...(mediaDevicesRef.current
        ? { mediaDevices: mediaDevicesRef.current }
        : {}),
      ...(createPcRef.current
        ? { createPeerConnection: createPcRef.current }
        : {}),
      ...(peerConfigRef.current ? { peerConfig: peerConfigRef.current } : {}),
      ...(talkbackPlaybackRef.current
        ? { talkbackPlayback: talkbackPlaybackRef.current }
        : {}),
      maxParents: maxParentsRef.current,
      onParentsChange: sync,
    });
    managerRef.current = manager;
    manager.start().catch(() => {});
    return () => {
      manager.stop();
      managerRef.current = null;
      if (mountedRef.current) {
        setParents([]);
        setCapReached(false);
        setCapturing(false);
      }
    };
    // Keyed only on the significant inputs; volatile props are read via refs.
  }, [pairedSessionId, transport, sync]);

  // Derive cap-reached from the live list: the notice shows the instant the
  // tracked parents hit the cap, and clears when one leaves. This is honest
  // (driven by the real list) and does not require threading a rejection
  // callback through the transport seam.
  const atCap = parents.length >= maxParents;
  useEffect(() => {
    if (atCap) {
      setCapReached(true);
    } else {
      setCapReached(false);
    }
  }, [atCap]);

  const connectedCount = parents.filter(p => p.status === 'connected').length;

  return {
    parents,
    connectedCount,
    maxParents,
    capReached,
    capturing,
  };
}
