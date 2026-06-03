/**
 * Tests for wiring the alert data channel into the live signalling session
 * (DMY-71).
 *
 * The session owns the channel LIFECYCLE by role and hands the ready channel to
 * `onAlertChannel`:
 *   - RESPONDER (baby): opens `'baby-monitor-alert'` BEFORE the answer and
 *     invokes the callback with the channel it created.
 *   - INITIATOR (parent): receives the channel via the peer's `datachannel`
 *     event and invokes the callback.
 * On teardown the caller's cleanup runs and the channel is closed — no leaked
 * handlers across a reconnect (a fresh session per attempt gets a fresh channel).
 *
 * Routing is validated end-to-end against the SAME adapters production uses:
 *  - baby raises an AlertEvent → `pushAlertsToChannel` → `sendAlertOverChannel`,
 *  - parent receives it → `receiveAlertsFromChannel` → presenter (DMY-46) +
 *    haptic (DMY-28).
 */
import { ALERT_CHANNEL_LABEL } from '../../alerts/alertChannel';
import {
  pushAlertsToChannel,
  receiveAlertsFromChannel,
} from '../../alerts/alertChannel';
import type { AlertChannelSource } from '../../alerts/alertChannel';
import type { AlertNotificationPresenter } from '../../alerts/notificationPresenter';
import type { HapticFeedback } from '../../alerts/hapticFeedback';
import type { AlertEvent } from '../../alerts/alertTypes';
import { createLoopbackTransportPair } from '../signalingTransport';
import { createSignalingSession } from '../signalingSession';
import type {
  DataChannel,
  PeerConnection,
  PeerConnectionEvents,
  PeerConnectionState,
  SignalingIceCandidate,
  SignalingSdp,
} from '../signalingTypes';

const SID = 'pair-alert-xyz';

/** In-memory fake DataChannel: records sends, lets a test push inbound. */
class FakeDataChannel implements DataChannel {
  closed = false;
  readonly sent: string[] = [];
  private readonly messageHandlers = new Set<(p: string) => void>();
  private readonly closeHandlers = new Set<() => void>();
  constructor(public readonly label: string) {}

  send(payload: string): boolean {
    if (this.closed) {
      return false;
    }
    this.sent.push(payload);
    return true;
  }
  onMessage(handler: (p: string) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }
  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
  isOpen(): boolean {
    return !this.closed;
  }
  close(): void {
    this.closed = true;
  }
  /** Test helper: simulate a peer message. */
  receive(payload: string): void {
    for (const h of this.messageHandlers) {
      h(payload);
    }
  }
  /** Number of live message subscribers (to assert no leak). */
  messageSubscriberCount(): number {
    return this.messageHandlers.size;
  }
}

/** A mock peer connection that supports data channels + emitting `datachannel`. */
class DcMockPeerConnection implements PeerConnection {
  state: PeerConnectionState = 'new';
  remoteSet = false;
  /** The channel WE created (responder), if any. */
  createdChannel: FakeDataChannel | null = null;

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
  addIceCandidate = jest.fn(async (_c: SignalingIceCandidate): Promise<void> => {});
  addAudioTrack = jest.fn();
  addVideoTrack = jest.fn(() => null);

  createDataChannel = jest.fn((label: string): DataChannel | null => {
    const ch = new FakeDataChannel(label);
    this.createdChannel = ch;
    return ch;
  });

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
  close = jest.fn();

  emitState(state: PeerConnectionState): void {
    this.state = state;
    for (const h of this.handlers.connectionstatechange) {
      h(state);
    }
  }
  /** Test helper: the peer opened a remote data channel. */
  emitDataChannel(channel: DataChannel): void {
    for (const h of this.handlers.datachannel) {
      h(channel);
    }
  }
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

const cryEvent: AlertEvent = {
  type: 'cry',
  timestamp: 1_700_000_000_000,
  soundId: 'alert-cry',
};

/** A test-driven alert source (baby side). */
function makeSource(): {
  source: AlertChannelSource;
  emit: (e: AlertEvent) => void;
  subscriberCount: () => number;
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
    subscriberCount: () => handlers.size,
  };
}

describe('SignalingSession alert datachannel wiring (DMY-71)', () => {
  it('responder opens the alert channel BEFORE the answer and hands it over', async () => {
    const { a, b } = createLoopbackTransportPair();
    const responderPc = new DcMockPeerConnection();
    const channels: DataChannel[] = [];

    const responder = createSignalingSession({
      role: 'responder',
      sessionId: SID,
      transport: b,
      createPeerConnection: () => responderPc,
      onAlertChannel: ch => {
        channels.push(ch);
      },
    });

    await responder.start();
    // The channel is created with the negotiated label, BEFORE any answer.
    expect(responderPc.createDataChannel).toHaveBeenCalledWith(
      ALERT_CHANNEL_LABEL,
    );
    expect(responderPc.createAnswer).not.toHaveBeenCalled();
    expect(channels).toHaveLength(1);
    expect(channels[0].label).toBe(ALERT_CHANNEL_LABEL);

    // The order holds even after the offer arrives and the answer is built.
    await a.connect();
    a.send({
      type: 'offer',
      sessionId: SID,
      from: 'initiator',
      description: { type: 'offer', sdp: 'offer-sdp' },
    });
    await flush();
    expect(responderPc.createAnswer).toHaveBeenCalledTimes(1);
  });

  it('initiator receives the channel via the datachannel event (only the alert label)', async () => {
    const { a } = createLoopbackTransportPair();
    const initiatorPc = new DcMockPeerConnection();
    const channels: DataChannel[] = [];

    const initiator = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => initiatorPc,
      onAlertChannel: ch => {
        channels.push(ch);
      },
    });
    await initiator.start();

    // A non-alert channel is ignored.
    initiatorPc.emitDataChannel(new FakeDataChannel('some-other-channel'));
    expect(channels).toHaveLength(0);

    // The alert channel is adopted.
    const alertCh = new FakeDataChannel(ALERT_CHANNEL_LABEL);
    initiatorPc.emitDataChannel(alertCh);
    expect(channels).toEqual([alertCh]);

    // A second alert channel is ignored (we keep one).
    initiatorPc.emitDataChannel(new FakeDataChannel(ALERT_CHANNEL_LABEL));
    expect(channels).toHaveLength(1);
  });

  it('routes baby raised AlertEvent → parent notification + haptic end-to-end', async () => {
    // baby (responder) side: open the channel, push from the source.
    const responderPc = new DcMockPeerConnection();
    const { source, emit } = makeSource();
    const { b } = createLoopbackTransportPair();
    const responder = createSignalingSession({
      role: 'responder',
      sessionId: SID,
      transport: b,
      createPeerConnection: () => responderPc,
      onAlertChannel: ch => pushAlertsToChannel(ch, source),
    });
    await responder.start();
    const babyChannel = responderPc.createdChannel;
    expect(babyChannel).not.toBeNull();

    // parent (initiator) side: receive on the SAME fake channel object (we model
    // the wire by handing the parent's receiver the baby's channel and pumping
    // its `sent` payloads into the parent's `receive`). Use a dedicated parent
    // channel + bridge so the assertion exercises receiveAlertsFromChannel.
    const parentChannel = new FakeDataChannel(ALERT_CHANNEL_LABEL);
    const present = jest.fn();
    const trigger = jest.fn();
    const presenter: AlertNotificationPresenter = { present };
    const haptic: HapticFeedback = { trigger };

    const initiatorPc = new DcMockPeerConnection();
    const { a } = createLoopbackTransportPair();
    const initiator = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a,
      createPeerConnection: () => initiatorPc,
      onAlertChannel: ch => receiveAlertsFromChannel(ch, { presenter, haptic }),
    });
    await initiator.start();
    initiatorPc.emitDataChannel(parentChannel);

    // Baby raises an alert → it is serialized onto the baby channel; bridge that
    // payload to the parent channel (the loopback "wire").
    emit(cryEvent);
    expect(babyChannel!.sent).toHaveLength(1);
    parentChannel.receive(babyChannel!.sent[0]);

    // Parent fired BOTH sinks for the valid alert.
    expect(present).toHaveBeenCalledTimes(1);
    expect(present.mock.calls[0][0]).toMatchObject({ type: 'cry' });
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('detaches the wiring AND closes the channel on stop (no leaked handlers)', async () => {
    const responderPc = new DcMockPeerConnection();
    const { source, emit, subscriberCount } = makeSource();
    const { b } = createLoopbackTransportPair();
    const responder = createSignalingSession({
      role: 'responder',
      sessionId: SID,
      transport: b,
      createPeerConnection: () => responderPc,
      onAlertChannel: ch => pushAlertsToChannel(ch, source),
    });
    await responder.start();
    expect(subscriberCount()).toBe(1);
    const channel = responderPc.createdChannel!;

    responder.stop();
    // Source subscription detached, channel closed — no leak.
    expect(subscriberCount()).toBe(0);
    expect(channel.closed).toBe(true);
    // A post-stop alert reaches nothing.
    emit(cryEvent);
    expect(channel.sent).toHaveLength(0);
  });

  it('parent: detaches the receiver listener on stop (no double-handler on reconnect)', async () => {
    const present = jest.fn();
    const presenter: AlertNotificationPresenter = { present };

    // First session.
    const pc1 = new DcMockPeerConnection();
    const { a: a1 } = createLoopbackTransportPair();
    const s1 = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a1,
      createPeerConnection: () => pc1,
      onAlertChannel: ch => receiveAlertsFromChannel(ch, { presenter }),
    });
    await s1.start();
    const ch1 = new FakeDataChannel(ALERT_CHANNEL_LABEL);
    pc1.emitDataChannel(ch1);
    expect(ch1.messageSubscriberCount()).toBe(1);

    // Teardown detaches the listener and closes the channel.
    s1.stop();
    expect(ch1.messageSubscriberCount()).toBe(0);
    expect(ch1.closed).toBe(true);

    // Reconnect: a FRESH session gets a FRESH channel; exactly ONE handler fires.
    const pc2 = new DcMockPeerConnection();
    const { a: a2 } = createLoopbackTransportPair();
    const s2 = createSignalingSession({
      role: 'initiator',
      sessionId: SID,
      transport: a2,
      createPeerConnection: () => pc2,
      onAlertChannel: ch => receiveAlertsFromChannel(ch, { presenter }),
    });
    await s2.start();
    const ch2 = new FakeDataChannel(ALERT_CHANNEL_LABEL);
    pc2.emitDataChannel(ch2);

    ch2.receive(JSON.stringify({ type: 'cry', timestamp: 1 }));
    // Only the new session's single handler fired — no stale handler from s1.
    expect(present).toHaveBeenCalledTimes(1);

    s2.stop();
  });

  it('a thrown onAlertChannel callback does not break the handshake', async () => {
    const responderPc = new DcMockPeerConnection();
    const { b } = createLoopbackTransportPair();
    const responder = createSignalingSession({
      role: 'responder',
      sessionId: SID,
      transport: b,
      createPeerConnection: () => responderPc,
      onAlertChannel: () => {
        throw new Error('boom');
      },
    });
    await expect(responder.start()).resolves.toBeUndefined();
    expect(responder.getStatus()).not.toBe('failed');
  });

  it('degrades when the connection has no data-channel support (responder null)', async () => {
    const responderPc = new DcMockPeerConnection();
    responderPc.createDataChannel = jest.fn(
      (_label: string): DataChannel | null => null,
    );
    const onAlertChannel = jest.fn();
    const { b } = createLoopbackTransportPair();
    const responder = createSignalingSession({
      role: 'responder',
      sessionId: SID,
      transport: b,
      createPeerConnection: () => responderPc,
      onAlertChannel,
    });
    await responder.start();
    // No channel → callback never invoked; session still healthy.
    expect(onAlertChannel).not.toHaveBeenCalled();
    expect(responder.getStatus()).not.toBe('failed');
  });
});
