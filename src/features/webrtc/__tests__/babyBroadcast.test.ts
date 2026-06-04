/**
 * Unit tests for the baby-side fan-out manager (DMY-66).
 *
 * Drives the manager against mock peer connections, a fake shared-capture
 * media-devices source, and a fake multi-client accept-loop transport. Covers
 * the three acceptance criteria:
 *   - AC #1 fan-out: 3 parents → 3 peer connections, the SHARED capture's audio
 *     + video tracks published into EACH;
 *   - AC #2 isolation: one peer dropping (failed / bye) tears down ONLY that
 *     peer; the shared capture stays live while any parent remains and is
 *     released (camera+mic stopped) only when the LAST parent leaves;
 *   - AC #3 cap: a 4th parent is gracefully rejected with `max-parents`.
 */
import {
  createBabyBroadcast,
  MAX_PARENTS,
  type MultiClientSignalingTransport,
} from '../babyBroadcast';
import { createLoopbackTransportPair } from '../signalingTransport';
import {
  ALERT_CHANNEL_LABEL,
  serializeAlert,
} from '../../alerts/alertChannel';
import type { AlertChannelSource } from '../../alerts/alertChannel';
import type { AlertEvent } from '../../alerts/alertTypes';
import type { AudioPlayback } from '../audioPlayback';
import type { DataChannel } from '../signalingTypes';
import type {
  MediaDevicesLike,
  MediaStreamLike,
  MediaStreamTrackLike,
  RtpSenderLike,
} from '../mediaTypes';
import type {
  PeerConnection,
  PeerConnectionEvents,
  PeerConnectionState,
  SignalingIceCandidate,
  SignalingSdp,
  SignalingTransport,
} from '../signalingTypes';

const SID = 'pair-session-fanout';

/** A controllable mock PeerConnection (one per parent). */
class MockPeerConnection implements PeerConnection {
  state: PeerConnectionState = 'new';
  remoteSet = false;
  closed = false;
  readonly addedAudio: MediaStreamTrackLike[] = [];
  readonly addedVideo: MediaStreamTrackLike[] = [];

  private readonly handlers: {
    [K in keyof PeerConnectionEvents]: Set<PeerConnectionEvents[K]>;
  } = {
    icecandidate: new Set(),
    connectionstatechange: new Set(),
    track: new Set(),
    datachannel: new Set(),
  };

  createOffer = jest.fn(
    async (): Promise<SignalingSdp> => ({ type: 'offer', sdp: 'offer-sdp' }),
  );
  createAnswer = jest.fn(
    async (): Promise<SignalingSdp> => ({ type: 'answer', sdp: 'answer-sdp' }),
  );
  setRemoteDescription = jest.fn(async (): Promise<void> => {
    this.remoteSet = true;
  });
  addIceCandidate = jest.fn(
    async (_c: SignalingIceCandidate): Promise<void> => {},
  );

  addAudioTrack = jest.fn((track: MediaStreamTrackLike) => {
    this.addedAudio.push(track);
  });
  addVideoTrack = jest.fn(
    (track: MediaStreamTrackLike): RtpSenderLike | null => {
      this.addedVideo.push(track);
      return {
        setParameters: jest.fn(async () => {}),
        getParameters: () => ({ encodings: [{}] }),
        replaceTrack: jest.fn(async () => {}),
      } as unknown as RtpSenderLike;
    },
  );
  createDataChannel = jest.fn(
    (_label: string): DataChannel | null => null,
  );

  on<K extends keyof PeerConnectionEvents>(
    event: K,
    handler: PeerConnectionEvents[K],
  ): () => void {
    this.handlers[event].add(handler);
    return () => {
      this.handlers[event].delete(handler);
    };
  }

  getConnectionState(): PeerConnectionState {
    return this.state;
  }
  async getStats(): Promise<unknown> {
    return new Map();
  }
  hasRemoteDescription(): boolean {
    return this.remoteSet;
  }
  close = jest.fn((): void => {
    this.closed = true;
  });

  emitState(state: PeerConnectionState): void {
    this.state = state;
    for (const h of this.handlers.connectionstatechange) {
      h(state);
    }
  }

  emitTrack(event: unknown): void {
    for (const h of this.handlers.track) {
      h(event);
    }
  }
}

/** A fake shared capture (camera+mic) whose tracks track their stopped state. */
function makeCapture() {
  const audio: MediaStreamTrackLike = {
    kind: 'audio',
    enabled: true,
    stop: jest.fn(),
  };
  const video: MediaStreamTrackLike = {
    kind: 'video',
    enabled: true,
    stop: jest.fn(),
  };
  const tracks = [audio, video];
  const stream: MediaStreamLike = {
    getTracks: () => tracks,
    getAudioTracks: () => [audio],
    getVideoTracks: () => [video],
  };
  return { audio, video, stream };
}

/** A media-devices source that returns the SAME capture, counting calls. */
function makeMediaDevices(stream: MediaStreamLike) {
  const getUserMedia = jest.fn(async (): Promise<MediaStreamLike> => stream);
  const mediaDevices: MediaDevicesLike = { getUserMedia };
  return { mediaDevices, getUserMedia };
}

/** A fake multi-client accept loop the test drives synchronously. */
function makeMultiClientTransport() {
  let connectHandler:
    | ((clientId: string, transport: SignalingTransport) => void)
    | null = null;
  let disconnectHandler: ((clientId: string) => void) | null = null;
  const started = jest.fn();
  const closed = jest.fn();
  const transport: MultiClientSignalingTransport = {
    onClientConnect(handler) {
      connectHandler = handler;
      return () => {
        connectHandler = null;
      };
    },
    onClientDisconnect(handler) {
      disconnectHandler = handler;
      return () => {
        disconnectHandler = null;
      };
    },
    async start() {
      started();
    },
    close() {
      closed();
    },
  };
  return {
    transport,
    started,
    closed,
    connect: (id: string, tx: SignalingTransport) => connectHandler?.(id, tx),
    disconnect: (id: string) => disconnectHandler?.(id),
  };
}

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('createBabyBroadcast — fan-out', () => {
  it('AC#1: 3 parents → 3 peer connections, shared capture published into each', async () => {
    const cap = makeCapture();
    const { mediaDevices, getUserMedia } = makeMediaDevices(cap.stream);
    const pcs: MockPeerConnection[] = [];
    const broadcast = makeMultiClientTransport();

    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      createPeerConnection: () => {
        const pc = new MockPeerConnection();
        pcs.push(pc);
        return pc;
      },
    });
    await manager.start();

    for (const id of ['p1', 'p2', 'p3']) {
      const { a } = createLoopbackTransportPair();
      const res = await manager.addParent(id, a);
      expect(res).toEqual({ ok: true, peerId: id });
    }
    await flush();

    // 3 independent peer connections, one per parent.
    expect(pcs).toHaveLength(3);
    expect(manager.getParents()).toHaveLength(3);

    // ONE capture acquired and SHARED across all three peers.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    for (const pc of pcs) {
      expect(pc.addedAudio).toContain(cap.audio);
      expect(pc.addedVideo).toContain(cap.video);
    }
    expect(manager.isCapturing()).toBe(true);

    manager.stop();
  });

  it('AC#1: a parent connecting via the accept loop is added automatically', async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const broadcast = makeMultiClientTransport();
    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      createPeerConnection: () => new MockPeerConnection(),
    });
    await manager.start();
    expect(broadcast.started).toHaveBeenCalled();

    const { a } = createLoopbackTransportPair();
    broadcast.connect('viaLoop', a);
    await flush();

    expect(manager.getParents().map(p => p.clientId)).toEqual(['viaLoop']);
    manager.stop();
  });

  it('AC#2: one peer failing tears down ONLY that peer; others survive; capture stays live', async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const order: MockPeerConnection[] = [];
    const broadcast = makeMultiClientTransport();
    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      createPeerConnection: () => {
        const pc = new MockPeerConnection();
        order.push(pc);
        return pc;
      },
    });
    await manager.start();
    for (const id of ['p1', 'p2', 'p3']) {
      const { a } = createLoopbackTransportPair();
      await manager.addParent(id, a);
    }
    await flush();
    expect(manager.getParents().map(p => p.clientId)).toEqual([
      'p1',
      'p2',
      'p3',
    ]);

    const [pc1, pc2, pc3] = order;
    // p2's peer connection genuinely fails.
    pc2.emitState('failed');
    await flush();

    // Only p2 is gone; p1 and p3 remain and their pcs are NOT closed.
    expect(manager.getParents().map(p => p.clientId)).toEqual(['p1', 'p3']);
    expect(pc2.closed).toBe(true);
    expect(pc1.closed).toBe(false);
    expect(pc3.closed).toBe(false);

    // The SHARED capture is still live — at least one parent remains (no leak,
    // no flicker for the survivors).
    expect(manager.isCapturing()).toBe(true);
    expect(cap.audio.stop).not.toHaveBeenCalled();
    expect(cap.video.stop).not.toHaveBeenCalled();

    manager.stop();
  });

  it('AC#2: capture (camera+mic) is released only when the LAST parent leaves', async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const broadcast = makeMultiClientTransport();
    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      createPeerConnection: () => new MockPeerConnection(),
    });
    await manager.start();

    for (const id of ['p1', 'p2']) {
      const { a } = createLoopbackTransportPair();
      await manager.addParent(id, a);
    }
    await flush();
    expect(manager.isCapturing()).toBe(true);

    manager.removeParent('p1');
    // One parent left → capture STILL live, tracks NOT stopped.
    expect(manager.isCapturing()).toBe(true);
    expect(cap.audio.stop).not.toHaveBeenCalled();
    expect(cap.video.stop).not.toHaveBeenCalled();

    manager.removeParent('p2');
    // Last parent gone → capture released, camera+mic tracks stopped (no leak).
    expect(manager.isCapturing()).toBe(false);
    expect(cap.audio.stop).toHaveBeenCalledTimes(1);
    expect(cap.video.stop).toHaveBeenCalledTimes(1);

    manager.stop();
  });

  it('AC#2: a remote `bye` drops only that parent (isolation)', async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const broadcast = makeMultiClientTransport();
    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      createPeerConnection: () => new MockPeerConnection(),
    });
    await manager.start();

    // p1 over a loopback PAIR so we can send a real `bye` from the parent side.
    const pair = createLoopbackTransportPair();
    await manager.addParent('p1', pair.a);
    const { a: p2a } = createLoopbackTransportPair();
    await manager.addParent('p2', p2a);
    await flush();
    expect(manager.getParents()).toHaveLength(2);

    // The parent end of p1's transport sends a polite hangup.
    await pair.b.connect();
    pair.b.send({ type: 'bye', sessionId: SID, from: 'initiator' });
    await flush();

    expect(manager.getParents().map(p => p.clientId)).toEqual(['p2']);
    expect(manager.isCapturing()).toBe(true);
    manager.stop();
  });

  it('AC#3: a parent beyond MAX_PARENTS is gracefully rejected with `max-parents`', async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const broadcast = makeMultiClientTransport();
    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      createPeerConnection: () => new MockPeerConnection(),
    });
    await manager.start();

    for (let i = 0; i < MAX_PARENTS; i++) {
      const { a } = createLoopbackTransportPair();
      const res = await manager.addParent(`p${i}`, a);
      expect(res.ok).toBe(true);
    }

    // The (MAX+1)th parent is rejected and its transport is closed cleanly.
    const extra = createLoopbackTransportPair();
    const closeSpy = jest.spyOn(extra.a, 'close');
    const res = await manager.addParent('overflow', extra.a);
    expect(res).toEqual({ ok: false, reason: 'max-parents' });
    expect(closeSpy).toHaveBeenCalled();
    expect(manager.getParents()).toHaveLength(MAX_PARENTS);

    manager.stop();
  });

  it('rejects a duplicate clientId without churning the existing session', async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const broadcast = makeMultiClientTransport();
    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      createPeerConnection: () => new MockPeerConnection(),
    });
    await manager.start();

    const { a } = createLoopbackTransportPair();
    expect((await manager.addParent('dup', a)).ok).toBe(true);
    const { a: a2 } = createLoopbackTransportPair();
    expect(await manager.addParent('dup', a2)).toEqual({
      ok: false,
      reason: 'duplicate',
    });
    expect(manager.getParents()).toHaveLength(1);
    manager.stop();
  });

  it('stop() tears down all peers, the accept loop and the shared capture', async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const order: MockPeerConnection[] = [];
    const broadcast = makeMultiClientTransport();
    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      createPeerConnection: () => {
        const pc = new MockPeerConnection();
        order.push(pc);
        return pc;
      },
    });
    await manager.start();
    for (const id of ['p1', 'p2']) {
      const { a } = createLoopbackTransportPair();
      await manager.addParent(id, a);
    }
    await flush();

    manager.stop();

    expect(manager.getParents()).toHaveLength(0);
    expect(manager.isCapturing()).toBe(false);
    expect(cap.audio.stop).toHaveBeenCalledTimes(1);
    expect(broadcast.closed).toHaveBeenCalled();
    for (const pc of order) {
      expect(pc.closed).toBe(true);
    }

    // addParent after stop is rejected.
    const { a } = createLoopbackTransportPair();
    expect(await manager.addParent('late', a)).toEqual({
      ok: false,
      reason: 'stopped',
    });
  });

  it('notifies onParentsChange as parents come and go', async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const snapshots: number[] = [];
    const broadcast = makeMultiClientTransport();
    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      createPeerConnection: () => new MockPeerConnection(),
      onParentsChange: parents => snapshots.push(parents.length),
    });
    await manager.start();

    const { a } = createLoopbackTransportPair();
    await manager.addParent('p1', a);
    const { a: a2 } = createLoopbackTransportPair();
    await manager.addParent('p2', a2);
    manager.removeParent('p1');
    await flush();

    expect(snapshots).toContain(1);
    expect(snapshots).toContain(2);
    expect(snapshots[snapshots.length - 1]).toBe(1);
    manager.stop();
  });
});

describe('createBabyBroadcast — alert datachannel fan-out (DMY-71)', () => {
  /** A recording fake alert channel. */
  class FakeAlertChannel implements DataChannel {
    readonly label = ALERT_CHANNEL_LABEL;
    closed = false;
    readonly sent: string[] = [];
    send(p: string): boolean {
      if (this.closed) {
        return false;
      }
      this.sent.push(p);
      return true;
    }
    onMessage(): () => void {
      return () => {};
    }
    onClose(): () => void {
      return () => {};
    }
    isOpen(): boolean {
      return !this.closed;
    }
    close(): void {
      this.closed = true;
    }
  }

  /** A mock pc whose createDataChannel returns a recording fake. */
  class AlertPc extends MockPeerConnection {
    readonly alertChannel = new FakeAlertChannel();
    constructor() {
      super();
      this.createDataChannel = jest.fn(
        (_label: string): DataChannel | null => this.alertChannel,
      );
    }
  }

  function makeSource(): {
    source: AlertChannelSource;
    emit: (e: AlertEvent) => void;
  } {
    const handlers = new Set<(e: AlertEvent) => void>();
    return {
      source: {
        subscribe(h) {
          handlers.add(h);
          return () => handlers.delete(h);
        },
      },
      emit(e) {
        for (const h of handlers) {
          h(e);
        }
      },
    };
  }

  const cry: AlertEvent = {
    type: 'cry',
    timestamp: 1_700_000_000_000,
    soundId: 'alert-cry',
  };

  it('one raised AlertEvent fans out over EVERY connected parent channel', async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const pcs: AlertPc[] = [];
    const { source, emit } = makeSource();
    const broadcast = makeMultiClientTransport();

    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      alertSource: source,
      createPeerConnection: () => {
        const pc = new AlertPc();
        pcs.push(pc);
        return pc;
      },
    });
    await manager.start();
    for (const id of ['p1', 'p2', 'p3']) {
      const { a } = createLoopbackTransportPair();
      await manager.addParent(id, a);
    }
    await flush();

    expect(pcs).toHaveLength(3);
    emit(cry);
    // The same privacy-safe payload reached all three parents.
    for (const pc of pcs) {
      expect(pc.alertChannel.sent).toEqual([serializeAlert(cry)]);
    }
  });

  it("removing a parent detaches ONLY its channel (others keep receiving)", async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const pcs = new Map<string, AlertPc>();
    const { source, emit } = makeSource();
    const broadcast = makeMultiClientTransport();
    const ids: string[] = [];

    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      alertSource: source,
      createPeerConnection: () => {
        const pc = new AlertPc();
        // Sessions are created in addParent order; map by insertion.
        pcs.set(ids[pcs.size], pc);
        return pc;
      },
    });
    await manager.start();
    for (const id of ['p1', 'p2']) {
      ids.push(id);
      const { a } = createLoopbackTransportPair();
      await manager.addParent(id, a);
    }
    await flush();

    manager.removeParent('p1');
    const p1 = pcs.get('p1')!;
    const p2 = pcs.get('p2')!;
    // p1's channel closed on its teardown; its subscription detached.
    expect(p1.alertChannel.closed).toBe(true);

    emit(cry);
    // Only the still-connected parent receives the new alert.
    expect(p1.alertChannel.sent).toHaveLength(0);
    expect(p2.alertChannel.sent).toEqual([serializeAlert(cry)]);

    manager.stop();
  });

  it('manager.stop() closes EVERY parent alert channel and detaches all sources (no leak)', async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const pcs: AlertPc[] = [];
    const { source, emit } = makeSource();
    const broadcast = makeMultiClientTransport();

    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      alertSource: source,
      createPeerConnection: () => {
        const pc = new AlertPc();
        pcs.push(pc);
        return pc;
      },
    });
    await manager.start();
    for (const id of ['p1', 'p2', 'p3']) {
      const { a } = createLoopbackTransportPair();
      await manager.addParent(id, a);
    }
    await flush();
    expect(pcs).toHaveLength(3);

    manager.stop();

    // Every per-parent alert channel is closed on full teardown.
    for (const pc of pcs) {
      expect(pc.alertChannel.closed).toBe(true);
    }
    // And every source subscription is detached: a post-stop alert reaches none.
    emit(cry);
    for (const pc of pcs) {
      expect(pc.alertChannel.sent).toHaveLength(0);
    }
  });
});

// --- Two-way talk: parent→baby push-to-talk played on the baby (DMY-76) -------
//
// The parent (useMediaSession with enableTalkback) publishes a push-to-talk
// audio track onto its peer connection. On the baby, each parent's responder
// session must route that incoming remote AUDIO track to the talkback playback
// so the parent's voice comes out of the baby speaker — never fabricated, only on
// a real `ontrack`.
describe('createBabyBroadcast — two-way talk playback (DMY-76)', () => {
  function fakePlayback(): AudioPlayback & {
    start: jest.Mock;
    stop: jest.Mock;
  } {
    return {
      start: jest.fn(),
      stop: jest.fn(),
      setMuted: jest.fn(),
      setRoute: jest.fn(),
      getAvailableRoutes: jest.fn(() => ['speaker' as const]),
      setVolume: jest.fn(),
    } as unknown as AudioPlayback & { start: jest.Mock; stop: jest.Mock };
  }

  /** A remote parent-talk audio stream + its `ontrack` event. */
  function remoteTalkEvent() {
    const track: MediaStreamTrackLike = {
      kind: 'audio',
      enabled: true,
      stop: jest.fn(),
    };
    const stream: MediaStreamLike = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
      getVideoTracks: () => [],
    };
    return { track, stream, event: { track, streams: [stream] } };
  }

  it("plays a parent's incoming talk audio out of the baby speaker", async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const playback = fakePlayback();
    const pcs: MockPeerConnection[] = [];
    const broadcast = makeMultiClientTransport();
    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      talkbackPlayback: playback,
      createPeerConnection: () => {
        const pc = new MockPeerConnection();
        pcs.push(pc);
        return pc;
      },
    });
    await manager.start();
    const { a } = createLoopbackTransportPair();
    await manager.addParent('p1', a);
    await flush();

    expect(playback.start).not.toHaveBeenCalled();

    // The parent holds talk → a remote audio track arrives on this peer.
    const talk = remoteTalkEvent();
    pcs[0].emitTrack(talk.event);

    expect(playback.start).toHaveBeenCalledTimes(1);
    expect(playback.start).toHaveBeenCalledWith(talk.stream);

    manager.stop();
    // The talk session is stopped once the last parent (and capture) is gone.
    expect(playback.stop).toHaveBeenCalled();
  });

  it('ignores a non-audio remote track (never fabricates playback)', async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const playback = fakePlayback();
    const pcs: MockPeerConnection[] = [];
    const broadcast = makeMultiClientTransport();
    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      talkbackPlayback: playback,
      createPeerConnection: () => {
        const pc = new MockPeerConnection();
        pcs.push(pc);
        return pc;
      },
    });
    await manager.start();
    const { a } = createLoopbackTransportPair();
    await manager.addParent('p1', a);
    await flush();

    const videoTrack: MediaStreamTrackLike = {
      kind: 'video',
      enabled: true,
      stop: jest.fn(),
    };
    pcs[0].emitTrack({ track: videoTrack, streams: [] });

    expect(playback.start).not.toHaveBeenCalled();
    manager.stop();
  });

  it('plays each parent’s talk independently (per-peer ontrack)', async () => {
    const cap = makeCapture();
    const { mediaDevices } = makeMediaDevices(cap.stream);
    const playback = fakePlayback();
    const pcs: MockPeerConnection[] = [];
    const broadcast = makeMultiClientTransport();
    const manager = createBabyBroadcast({
      sessionId: SID,
      transport: broadcast.transport,
      mediaDevices,
      talkbackPlayback: playback,
      createPeerConnection: () => {
        const pc = new MockPeerConnection();
        pcs.push(pc);
        return pc;
      },
    });
    await manager.start();
    for (const id of ['p1', 'p2']) {
      const { a } = createLoopbackTransportPair();
      await manager.addParent(id, a);
    }
    await flush();

    pcs[0].emitTrack(remoteTalkEvent().event);
    pcs[1].emitTrack(remoteTalkEvent().event);

    expect(playback.start).toHaveBeenCalledTimes(2);
    manager.stop();
  });
});
