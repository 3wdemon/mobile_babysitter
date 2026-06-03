/**
 * Privacy tests for the signalling layer (DMY-16).
 *
 * SDP and ICE candidates are sensitive network metadata. They must never reach
 * the console in the clear. These tests assert that when a signalling message
 * (offer/answer/ice) is passed through the redacting logger, the `sdp` and
 * `candidate` values are masked, and that the session/peer-connection modules
 * never log raw SDP/candidate strings during a handshake.
 */
import { logger } from '../../../services/logger';
import { REDACTED } from '../../../services/logger/redact';
import { createLoopbackTransportPair } from '../signalingTransport';
import { createSignalingSession } from '../signalingSession';
import type {
  PeerConnection,
  PeerConnectionEvents,
  PeerConnectionState,
  SignalingIceCandidate,
  SignalingMessage,
  SignalingSdp,
} from '../signalingTypes';

class MockPeerConnection implements PeerConnection {
  state: PeerConnectionState = 'new';
  remoteSet = false;
  private readonly handlers: {
    [K in keyof PeerConnectionEvents]: Set<PeerConnectionEvents[K]>;
  } = {
    icecandidate: new Set(),
    connectionstatechange: new Set(),
    track: new Set(),
    datachannel: new Set(),
  };
  createOffer = jest.fn(
    async (): Promise<SignalingSdp> => ({
      type: 'offer',
      sdp: 'v=0 super-secret-local-ip-10.0.0.5',
    }),
  );
  createAnswer = jest.fn(
    async (): Promise<SignalingSdp> => ({ type: 'answer', sdp: 'v=0 answer' }),
  );
  setRemoteDescription = jest.fn(async () => {
    this.remoteSet = true;
  });
  addIceCandidate = jest.fn(async (_c: SignalingIceCandidate) => {});
  addAudioTrack = jest.fn();
  addVideoTrack = jest.fn(() => null);
  createDataChannel = jest.fn(() => null);
  on<K extends keyof PeerConnectionEvents>(
    event: K,
    handler: PeerConnectionEvents[K],
  ): () => void {
    this.handlers[event].add(handler);
    return () => this.handlers[event].delete(handler);
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
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

describe('signalling privacy / redaction', () => {
  let spies: Record<'log' | 'info' | 'warn' | 'error', jest.SpyInstance>;
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  beforeEach(() => {
    // Force dev so debug/info are emitted and can be inspected.
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    spies = {
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  function allLoggedText(): string {
    const parts: string[] = [];
    for (const spy of Object.values(spies)) {
      for (const call of spy.mock.calls) {
        parts.push(JSON.stringify(call));
      }
    }
    return parts.join('\n');
  }

  it('redacts the sdp of an offer message logged through the logger', () => {
    const message: SignalingMessage = {
      type: 'offer',
      sessionId: 's',
      from: 'initiator',
      description: { type: 'offer', sdp: 'v=0 host 10.0.0.7' },
    };
    logger.info('signaling message', message);
    const text = allLoggedText();
    expect(text).not.toContain('10.0.0.7');
    expect(text).toContain(REDACTED);
  });

  it('redacts the candidate of an ICE message logged through the logger', () => {
    const message: SignalingMessage = {
      type: 'ice-candidate',
      sessionId: 's',
      from: 'responder',
      candidate: {
        candidate: 'candidate:1 1 udp 2122260223 192.168.1.42 54321 typ host',
        sdpMid: '0',
      },
    };
    logger.info('ice', message);
    const text = allLoggedText();
    expect(text).not.toContain('192.168.1.42');
    expect(text).toContain(REDACTED);
  });

  it('a full handshake never logs the raw SDP / candidate in the clear', async () => {
    const { a, b } = createLoopbackTransportPair();
    const initiatorPc = new MockPeerConnection();
    const responderPc = new MockPeerConnection();

    const initiator = createSignalingSession({
      role: 'initiator',
      sessionId: 's',
      transport: a,
      createPeerConnection: () => initiatorPc,
    });
    const responder = createSignalingSession({
      role: 'responder',
      sessionId: 's',
      transport: b,
      createPeerConnection: () => responderPc,
    });

    await responder.start();
    await initiator.start();
    await flush();

    const text = allLoggedText();
    // The offer SDP carried a fake "secret" local IP — it must not appear.
    expect(text).not.toContain('super-secret-local-ip');
    expect(text).not.toContain('10.0.0.5');

    initiator.stop();
    responder.stop();
  });
});
