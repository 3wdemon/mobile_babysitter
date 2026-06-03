/**
 * Unit tests for the loopback signalling transport + the integration stub
 * (DMY-16).
 */
import {
  createLoopbackTransportPair,
  createLocalSocketTransport,
} from '../signalingTransport';
import type { SignalingMessage } from '../signalingTypes';

const SID = 'session-1';

function offer(from: 'initiator' | 'responder'): SignalingMessage {
  return {
    type: 'offer',
    sessionId: SID,
    from,
    description: { type: 'offer', sdp: 'sdp' },
  };
}

describe('createLoopbackTransportPair', () => {
  it('delivers a send on one endpoint to the other endpoint (async)', async () => {
    const { a, b } = createLoopbackTransportPair();
    await a.connect();
    await b.connect();

    const received: SignalingMessage[] = [];
    b.onMessage(m => received.push(m));

    a.send(offer('initiator'));
    // Delivery is async (microtask), like a real channel.
    expect(received).toHaveLength(0);
    await Promise.resolve();
    expect(received).toEqual([offer('initiator')]);
  });

  it('is bidirectional', async () => {
    const { a, b } = createLoopbackTransportPair();
    await a.connect();
    await b.connect();
    const onA: SignalingMessage[] = [];
    a.onMessage(m => onA.push(m));
    b.send(offer('responder'));
    await Promise.resolve();
    expect(onA).toEqual([offer('responder')]);
  });

  it('drops sends issued before connect()', async () => {
    const { a, b } = createLoopbackTransportPair();
    const received: SignalingMessage[] = [];
    b.onMessage(m => received.push(m));
    a.send(offer('initiator')); // not connected yet
    await Promise.resolve();
    expect(received).toHaveLength(0);
  });

  it('unsubscribe stops further delivery', async () => {
    const { a, b } = createLoopbackTransportPair();
    await a.connect();
    await b.connect();
    const received: SignalingMessage[] = [];
    const off = b.onMessage(m => received.push(m));
    off();
    a.send(offer('initiator'));
    await Promise.resolve();
    expect(received).toHaveLength(0);
  });

  it('after close(), sends are dropped and no messages are delivered', async () => {
    const { a, b } = createLoopbackTransportPair();
    await a.connect();
    await b.connect();
    const received: SignalingMessage[] = [];
    b.onMessage(m => received.push(m));

    b.close();
    a.send(offer('initiator'));
    await Promise.resolve();
    expect(received).toHaveLength(0);

    // a.close after b.close is fine; close is idempotent.
    a.close();
    a.close();
  });

  it('a throwing message handler is reported via onError and does not abort', async () => {
    const { a, b } = createLoopbackTransportPair();
    await a.connect();
    await b.connect();
    const errors: unknown[] = [];
    const seen: SignalingMessage[] = [];
    b.onError(e => errors.push(e));
    b.onMessage(() => {
      throw new Error('handler boom');
    });
    b.onMessage(m => seen.push(m));

    a.send(offer('initiator'));
    await Promise.resolve();

    expect(errors).toHaveLength(1);
    expect(seen).toEqual([offer('initiator')]);
  });
});

describe('createLocalSocketTransport (real socket transport, DMY-45)', () => {
  it('responder (baby) uses the listen seam — default throws (no JS WS server in RN)', () => {
    expect(() =>
      createLocalSocketTransport({
        host: '0.0.0.0',
        port: 8443,
        sessionId: SID,
        role: 'responder',
      }),
    ).toThrow(/no local WebSocket SERVER/);
  });

  it('responder delegates to an injected server factory', () => {
    const fake = createLoopbackTransportPair().a;
    const serverFactory = jest.fn(() => fake);
    const tx = createLocalSocketTransport(
      { host: '0.0.0.0', port: 8443, sessionId: SID, role: 'responder' },
      { serverFactory },
    );
    expect(serverFactory).toHaveBeenCalledTimes(1);
    expect(tx).toBe(fake);
  });

  it('initiator (parent) builds a dialing transport (full behaviour: socketSignalingTransport.test)', () => {
    // Constructing the dialing transport does NOT throw (no factory call until
    // connect). Full dial behaviour is covered in socketSignalingTransport.test.
    const tx = createLocalSocketTransport({
      host: '192.168.1.5',
      port: 8443,
      sessionId: SID,
      role: 'initiator',
    });
    expect(typeof tx.connect).toBe('function');
    expect(typeof tx.send).toBe('function');
    tx.close();
  });
});
