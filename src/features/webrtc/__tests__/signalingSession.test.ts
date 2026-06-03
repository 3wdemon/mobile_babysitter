/**
 * Integration tests for the signalling state machine (DMY-16).
 *
 * Runs the FULL initiator↔responder handshake over an in-memory loopback
 * transport with a controllable mock PeerConnection (no native WebRTC). Covers:
 *   - offer → answer → ICE (both directions) → connectionState 'connected',
 *   - early ICE candidates (before the remote description) are buffered then
 *     flushed,
 *   - the failure path (peer 'failed' → session 'failed') with no crash,
 *   - cleanup (peer connection + transport closed on stop), and that the session
 *     never fabricates 'connected'.
 */
import { createLoopbackTransportPair } from '../signalingTransport';
import {
  createSignalingSession,
  SignalingSession,
} from '../signalingSession';
import type { SignalingSessionStatus } from '../signalingSession';
import type {
  PeerConnection,
  PeerConnectionEvents,
  PeerConnectionState,
  SignalingIceCandidate,
  SignalingMessage,
  SignalingSdp,
} from '../signalingTypes';

/** A controllable mock PeerConnection driven by the test. */
class MockPeerConnection implements PeerConnection {
  state: PeerConnectionState = 'new';
  remoteSet = false;
  closed = false;
  readonly addedCandidates: SignalingIceCandidate[] = [];

  private readonly handlers: {
    [K in keyof PeerConnectionEvents]: Set<PeerConnectionEvents[K]>;
  } = {
    icecandidate: new Set(),
    connectionstatechange: new Set(),
    track: new Set(),
    datachannel: new Set(),
  };

  // Track what was created, to assert ordering.
  readonly created: string[] = [];

  createOffer = jest.fn(async (): Promise<SignalingSdp> => {
    this.created.push('offer');
    return { type: 'offer', sdp: 'offer-sdp' };
  });

  createAnswer = jest.fn(async (): Promise<SignalingSdp> => {
    this.created.push('answer');
    return { type: 'answer', sdp: 'answer-sdp' };
  });

  setRemoteDescription = jest.fn(async (): Promise<void> => {
    this.remoteSet = true;
  });

  addIceCandidate = jest.fn(async (c: SignalingIceCandidate): Promise<void> => {
    this.addedCandidates.push(c);
  });

  addAudioTrack = jest.fn();
  addVideoTrack = jest.fn(() => null);
  createDataChannel = jest.fn(() => null);

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

  // --- test drivers ---
  emitState(state: PeerConnectionState): void {
    this.state = state;
    for (const h of this.handlers.connectionstatechange) {
      h(state);
    }
  }

  emitLocalIce(candidate: SignalingIceCandidate | null): void {
    for (const h of this.handlers.icecandidate) {
      h(candidate);
    }
  }

  emitTrack(event: unknown): void {
    for (const h of this.handlers.track) {
      h(event);
    }
  }
}

const SID = 'pair-session-xyz';

interface Harness {
  initiator: SignalingSession;
  responder: SignalingSession;
  initiatorPc: MockPeerConnection;
  responderPc: MockPeerConnection;
  initiatorStatuses: SignalingSessionStatus[];
  responderStatuses: SignalingSessionStatus[];
}

function makeHarness(): Harness {
  const { a, b } = createLoopbackTransportPair();
  const initiatorPc = new MockPeerConnection();
  const responderPc = new MockPeerConnection();
  const initiatorStatuses: SignalingSessionStatus[] = [];
  const responderStatuses: SignalingSessionStatus[] = [];

  const initiator = createSignalingSession({
    role: 'initiator',
    sessionId: SID,
    transport: a,
    createPeerConnection: () => initiatorPc,
    onStatusChange: s => initiatorStatuses.push(s),
  });
  const responder = createSignalingSession({
    role: 'responder',
    sessionId: SID,
    transport: b,
    createPeerConnection: () => responderPc,
    onStatusChange: s => responderStatuses.push(s),
  });

  return {
    initiator,
    responder,
    initiatorPc,
    responderPc,
    initiatorStatuses,
    responderStatuses,
  };
}

/** Drain queued microtasks (loopback delivery + async message handling). */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('SignalingSession handshake', () => {
  it('completes offer → answer → ICE both ways and reaches connected', async () => {
    const h = makeHarness();

    await h.responder.start();
    await h.initiator.start();
    await flush();

    // Offer/answer were exchanged and applied.
    expect(h.initiatorPc.createOffer).toHaveBeenCalledTimes(1);
    expect(h.responderPc.setRemoteDescription).toHaveBeenCalledWith({
      type: 'offer',
      sdp: 'offer-sdp',
    });
    expect(h.responderPc.createAnswer).toHaveBeenCalledTimes(1);
    expect(h.initiatorPc.setRemoteDescription).toHaveBeenCalledWith({
      type: 'answer',
      sdp: 'answer-sdp',
    });

    // ICE trickled both ways (remote description already set on both ends).
    h.initiatorPc.emitLocalIce({ candidate: 'init-cand', sdpMid: '0' });
    h.responderPc.emitLocalIce({ candidate: 'resp-cand', sdpMid: '0' });
    await flush();

    expect(h.responderPc.addedCandidates).toEqual([
      { candidate: 'init-cand', sdpMid: '0' },
    ]);
    expect(h.initiatorPc.addedCandidates).toEqual([
      { candidate: 'resp-cand', sdpMid: '0' },
    ]);

    // Connected only when the REAL peer event fires — never fabricated.
    expect(h.initiator.getStatus()).not.toBe('connected');
    h.initiatorPc.emitState('connected');
    h.responderPc.emitState('connected');

    expect(h.initiator.getStatus()).toBe('connected');
    expect(h.responder.getStatus()).toBe('connected');
    expect(h.initiatorStatuses).toContain('connecting');
    expect(h.initiatorStatuses).toContain('connected');
  });

  it('end-of-candidates (null) sentinel is not forwarded', async () => {
    const h = makeHarness();
    await h.responder.start();
    await h.initiator.start();
    await flush();

    h.initiatorPc.emitLocalIce(null);
    await flush();
    expect(h.responderPc.addedCandidates).toHaveLength(0);
  });

  it('buffers ICE candidates that arrive before the remote description, then flushes them in order', async () => {
    const { a, b } = createLoopbackTransportPair();
    const initiatorPc = new MockPeerConnection();
    const responderPc = new MockPeerConnection();

    // Make the responder slow to apply the remote description so the
    // initiator's ICE arrives first.
    let resolveRemote: () => void = () => {};
    responderPc.setRemoteDescription = jest.fn(
      () =>
        new Promise<void>(resolve => {
          resolveRemote = () => {
            responderPc.remoteSet = true;
            resolve();
          };
        }),
    );

    const initiator = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => initiatorPc,
    });
    const responder = createSignalingSession({
      role: 'responder',
      sessionId: SID,
      transport: b,
      createPeerConnection: () => responderPc,
    });

    await responder.start();
    await initiator.start();
    await flush();

    // Responder is mid-applying the offer (remote description NOT set yet).
    expect(responderPc.hasRemoteDescription()).toBe(false);

    // Two ICE candidates from the initiator arrive early → must be buffered.
    initiatorPc.emitLocalIce({ candidate: 'early-1' });
    initiatorPc.emitLocalIce({ candidate: 'early-2' });
    await flush();
    expect(responderPc.addedCandidates).toHaveLength(0);

    // Now the remote description lands → buffered candidates flush in order.
    resolveRemote();
    await flush();

    expect(responderPc.addedCandidates).toEqual([
      { candidate: 'early-1' },
      { candidate: 'early-2' },
    ]);

    initiator.stop();
    responder.stop();
  });

  it('failure: a peer "failed" connection-state maps to session failed, no crash', async () => {
    const h = makeHarness();
    await h.responder.start();
    await h.initiator.start();
    await flush();

    expect(() => h.initiatorPc.emitState('failed')).not.toThrow();
    expect(h.initiator.getStatus()).toBe('failed');
    // Teardown happened: peer connection closed.
    expect(h.initiatorPc.close).toHaveBeenCalled();
  });

  it('failure: a thrown setRemoteDescription on the responder maps to failed', async () => {
    const { a, b } = createLoopbackTransportPair();
    const initiatorPc = new MockPeerConnection();
    const responderPc = new MockPeerConnection();
    responderPc.setRemoteDescription = jest.fn(async () => {
      throw new Error('bad sdp');
    });
    const statuses: SignalingSessionStatus[] = [];
    const initiator = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => initiatorPc,
    });
    const responder = createSignalingSession({
      role: 'responder',
      sessionId: SID,
      transport: b,
      createPeerConnection: () => responderPc,
      onStatusChange: s => statuses.push(s),
    });

    await responder.start();
    await initiator.start();
    await flush();

    expect(responder.getStatus()).toBe('failed');
    expect(statuses).toContain('failed');
    initiator.stop();
  });

  it('failure: a transport error maps to failed', async () => {
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    // Wrap the transport so we can fire an error.
    let errHandler: ((e: unknown) => void) | undefined;
    const wrapped = {
      ...a,
      onError: (h: (e: unknown) => void) => {
        errHandler = h;
        return () => {};
      },
    };
    const session = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: wrapped,
      createPeerConnection: () => pc,
    });
    await session.start();
    await flush();

    errHandler?.(new Error('socket dropped'));
    expect(session.getStatus()).toBe('failed');
    expect(pc.close).toHaveBeenCalled();
  });

  it('ignores messages for a different session id and its own echoes', async () => {
    const { a, b } = createLoopbackTransportPair();
    const responderPc = new MockPeerConnection();
    const responder = createSignalingSession({
      role: 'responder',
      sessionId: SID,
      transport: b,
      createPeerConnection: () => responderPc,
    });
    await responder.start();
    await a.connect();

    // Wrong session id.
    a.send({
      type: 'offer',
      sessionId: 'other',
      from: 'initiator',
      description: { type: 'offer', sdp: 'x' },
    });
    // Own echo (responder sending to itself).
    a.send({
      type: 'offer',
      sessionId: SID,
      from: 'responder',
      description: { type: 'offer', sdp: 'x' },
    });
    await flush();

    expect(responderPc.setRemoteDescription).not.toHaveBeenCalled();
    responder.stop();
  });

  it('glare: an initiator ignores an unexpected inbound offer (no crash, no remote desc)', async () => {
    const { a, b } = createLoopbackTransportPair();
    const initiatorPc = new MockPeerConnection();
    const initiator = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => initiatorPc,
    });
    await initiator.start();
    await b.connect();
    await flush();
    initiatorPc.createOffer.mockClear();

    // Peer (responder) sends an offer too — a glare collision. The initiator
    // must ignore it (it is the offerer) rather than apply it or crash.
    b.send({
      type: 'offer',
      sessionId: SID,
      from: 'responder',
      description: { type: 'offer', sdp: 'glare-offer' },
    });
    await flush();

    expect(initiatorPc.setRemoteDescription).not.toHaveBeenCalledWith({
      type: 'offer',
      sdp: 'glare-offer',
    });
    expect(initiator.getStatus()).not.toBe('failed');
    initiator.stop();
  });

  it('a responder ignores an unexpected inbound answer (no crash)', async () => {
    const { a, b } = createLoopbackTransportPair();
    const responderPc = new MockPeerConnection();
    const responder = createSignalingSession({
      role: 'responder',
      sessionId: SID,
      transport: b,
      createPeerConnection: () => responderPc,
    });
    await responder.start();
    await a.connect();
    await flush();

    a.send({
      type: 'answer',
      sessionId: SID,
      from: 'initiator',
      description: { type: 'answer', sdp: 'stray-answer' },
    });
    await flush();

    expect(responderPc.setRemoteDescription).not.toHaveBeenCalled();
    expect(responder.getStatus()).not.toBe('failed');
    responder.stop();
  });

  it('a peer "bye" moves the session to disconnected without tearing down as failed', async () => {
    const { a, b } = createLoopbackTransportPair();
    const initiatorPc = new MockPeerConnection();
    const statuses: SignalingSessionStatus[] = [];
    const initiator = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => initiatorPc,
      onStatusChange: s => statuses.push(s),
    });
    await initiator.start();
    await b.connect();
    await flush();

    // Peer hangs up politely.
    b.send({ type: 'bye', sessionId: SID, from: 'responder' });
    await flush();

    expect(initiator.getStatus()).toBe('disconnected');
    expect(statuses).toContain('disconnected');
    expect(statuses).not.toContain('failed');
    initiator.stop();
  });

  it('a peer "bye" auto-tears-down: fires onBye and closes the pc + transport (DMY-45)', async () => {
    const { a, b } = createLoopbackTransportPair();
    const initiatorPc = new MockPeerConnection();
    const closeTransport = jest.spyOn(a, 'close');
    let byeCount = 0;
    const initiator = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => initiatorPc,
      onBye: () => {
        byeCount += 1;
      },
    });
    await initiator.start();
    await b.connect();
    await flush();

    b.send({ type: 'bye', sessionId: SID, from: 'responder' });
    await flush();

    // onBye fired, and the session tore down WITHOUT waiting for stop()/unmount.
    expect(byeCount).toBe(1);
    expect(initiatorPc.close).toHaveBeenCalledTimes(1);
    expect(closeTransport).toHaveBeenCalledTimes(1);
  });

  it('does NOT echo a "bye" back after receiving a remote "bye" (DMY-45)', async () => {
    const { a, b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const fromPeer: SignalingMessage[] = [];
    // Watch what the initiator sends to the peer.
    b.onMessage(m => fromPeer.push(m));
    const initiator = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => pc,
    });
    await initiator.start();
    await b.connect();
    await flush();
    fromPeer.length = 0; // ignore the offer

    b.send({ type: 'bye', sessionId: SID, from: 'responder' });
    await flush();
    // A subsequent stop() must NOT send a redundant bye to a peer that left.
    initiator.stop();
    await flush();

    expect(fromPeer.some(m => m.type === 'bye')).toBe(false);
  });

  it('forwards a remote track to onRemoteTrack', async () => {
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const tracks: unknown[] = [];
    const session = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => pc,
      onRemoteTrack: e => tracks.push(e),
    });
    await session.start();
    await flush();
    pc.emitTrack({ streams: ['remote'] });
    expect(tracks).toEqual([{ streams: ['remote'] }]);
    session.stop();
  });

  it('cleanup: stop() closes the peer connection and the transport; idempotent', async () => {
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const closeTransport = jest.spyOn(a, 'close');
    const session = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => pc,
    });
    await session.start();
    await flush();

    session.stop();
    session.stop(); // idempotent

    expect(pc.close).toHaveBeenCalledTimes(1);
    expect(closeTransport).toHaveBeenCalled();
  });

  it('a start() after stop() is a no-op (does not resurrect)', async () => {
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const session = new SignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => pc,
    });
    session.stop();
    await session.start();
    expect(pc.createOffer).not.toHaveBeenCalled();
  });

  it('start failure (factory throws) maps to failed without throwing', async () => {
    const { a } = createLoopbackTransportPair();
    const statuses: SignalingSessionStatus[] = [];
    const session = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => {
        throw new Error('no native module');
      },
      onStatusChange: s => statuses.push(s),
    });
    await expect(session.start()).resolves.toBeUndefined();
    expect(session.getStatus()).toBe('failed');
    expect(statuses).toEqual(['connecting', 'failed']);
  });
});

describe('SignalingSession media seams (DMY-18)', () => {
  it('awaits onPeerConnection BEFORE creating the offer (baby publishes audio first)', async () => {
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const order: string[] = [];
    pc.createOffer = jest.fn(async (): Promise<SignalingSdp> => {
      order.push('createOffer');
      return { type: 'offer', sdp: 'offer-sdp' };
    });

    const session = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => pc,
      onPeerConnection: async pcArg => {
        order.push('onPeerConnection-start');
        await Promise.resolve();
        // Publish a (fake) track during the hook, like the baby-unit would.
        pcArg.addAudioTrack(
          { kind: 'audio', enabled: true, stop: jest.fn() },
          { getTracks: () => [] },
        );
        order.push('onPeerConnection-end');
      },
    });

    await session.start();
    await flush();

    // The audio is published before the offer is built.
    expect(order).toEqual([
      'onPeerConnection-start',
      'onPeerConnection-end',
      'createOffer',
    ]);
    expect(pc.addAudioTrack).toHaveBeenCalledTimes(1);
    session.stop();
  });

  it('emits the local description (offer) for the encryption assertion', async () => {
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const seen: SignalingSdp[] = [];
    const session = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => pc,
      onLocalDescription: d => seen.push(d),
    });
    await session.start();
    await flush();
    expect(seen).toEqual([{ type: 'offer', sdp: 'offer-sdp' }]);
    session.stop();
  });

  it('emits the local description (answer) on the responder', async () => {
    const { a, b } = createLoopbackTransportPair();
    const initiatorPc = new MockPeerConnection();
    const responderPc = new MockPeerConnection();
    const seen: SignalingSdp[] = [];
    const initiator = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => initiatorPc,
    });
    const responder = createSignalingSession({
      role: 'responder',
      sessionId: SID,
      transport: b,
      createPeerConnection: () => responderPc,
      onLocalDescription: d => seen.push(d),
    });
    await responder.start();
    await initiator.start();
    await flush();
    expect(seen).toEqual([{ type: 'answer', sdp: 'answer-sdp' }]);
    responder.stop();
    initiator.stop();
  });

  it('a failing onPeerConnection hook fails the session (cannot negotiate media)', async () => {
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const statuses: SignalingSessionStatus[] = [];
    const session = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => pc,
      onStatusChange: s => statuses.push(s),
      onPeerConnection: async () => {
        throw new Error('mic denied');
      },
    });
    await expect(session.start()).resolves.toBeUndefined();
    expect(session.getStatus()).toBe('failed');
    expect(pc.createOffer).not.toHaveBeenCalled();
  });
});
