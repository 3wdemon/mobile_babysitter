/**
 * Unit tests for the REAL local socket signalling transport (DMY-45).
 *
 * Covers the parent (initiator) DIAL path over an injected fake WebSocket
 * client: connect/open, JSON framing, pre-open send buffering + flush,
 * inbound parse (good + malformed), connect-time vs post-open errors, close
 * before open, and idempotent close. The baby (responder) listen seam is the
 * native milestone — only its seam behaviour (default throws / injected factory
 * delegated) is asserted; live frames over a network are a device milestone.
 */
import {
  buildSignalingUrl,
  createLocalSocketTransport,
} from '../socketSignalingTransport';
import type { WebSocketLike } from '../socketSignalingTransport';
import type { SignalingMessage } from '../signalingTypes';

const SID = 'session-1';

/** A driveable fake WebSocket client implementing the structural contract. */
class FakeSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data?: unknown }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  onclose: ((event?: unknown) => void) | null = null;
  readonly sent: string[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }

  // --- test drivers ---
  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
  deliver(message: SignalingMessage | string): void {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    this.onmessage?.({ data });
  }
  fail(error?: unknown): void {
    this.onerror?.(error);
  }
  remoteClose(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }
}

function offer(from: 'initiator' | 'responder'): SignalingMessage {
  return {
    type: 'offer',
    sessionId: SID,
    from,
    description: { type: 'offer', sdp: 'sdp' },
  };
}

function initiator(socket: FakeSocket) {
  return createLocalSocketTransport(
    { host: '192.168.1.5', port: 8443, sessionId: SID, role: 'initiator' },
    { webSocketFactory: () => socket },
  );
}

describe('buildSignalingUrl', () => {
  it('builds a ws:// url on the local endpoint', () => {
    expect(buildSignalingUrl('192.168.1.5', 8443)).toBe('ws://192.168.1.5:8443');
  });
});

describe('dialing transport (initiator)', () => {
  it('connect() resolves once the socket opens', async () => {
    const socket = new FakeSocket();
    const tx = initiator(socket);
    const connected = tx.connect();
    let resolved = false;
    connected.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false); // not open yet
    socket.open();
    await connected;
    expect(resolved).toBe(true);
  });

  it('frames a send as JSON once open', async () => {
    const socket = new FakeSocket();
    const tx = initiator(socket);
    const p = tx.connect();
    socket.open();
    await p;
    tx.send(offer('initiator'));
    expect(socket.sent).toEqual([JSON.stringify(offer('initiator'))]);
  });

  it('buffers sends issued BEFORE open and flushes them on open', async () => {
    const socket = new FakeSocket();
    const tx = initiator(socket);
    const p = tx.connect();
    // send before open: must be enqueued, never thrown, not yet on the wire.
    tx.send(offer('initiator'));
    expect(socket.sent).toHaveLength(0);
    socket.open();
    await p;
    expect(socket.sent).toEqual([JSON.stringify(offer('initiator'))]);
  });

  it('parses inbound JSON frames and delivers them to onMessage', async () => {
    const socket = new FakeSocket();
    const tx = initiator(socket);
    const p = tx.connect();
    socket.open();
    await p;
    const received: SignalingMessage[] = [];
    tx.onMessage(m => received.push(m));
    socket.deliver(offer('responder'));
    expect(received).toEqual([offer('responder')]);
  });

  it('drops malformed inbound frames without throwing', async () => {
    const socket = new FakeSocket();
    const tx = initiator(socket);
    const p = tx.connect();
    socket.open();
    await p;
    const received: SignalingMessage[] = [];
    tx.onMessage(m => received.push(m));
    socket.deliver('not json {{{');
    socket.deliver(JSON.stringify({ type: 'garbage' }));
    socket.deliver(42 as unknown as string);
    expect(received).toHaveLength(0);
  });

  it('a connect-time error rejects connect()', async () => {
    const socket = new FakeSocket();
    const tx = initiator(socket);
    const p = tx.connect();
    socket.fail(new Error('refused'));
    await expect(p).rejects.toThrow('refused');
  });

  it('a close BEFORE open rejects connect()', async () => {
    const socket = new FakeSocket();
    const tx = initiator(socket);
    const p = tx.connect();
    socket.remoteClose();
    await expect(p).rejects.toThrow(/closed before open/);
  });

  it('a post-open error is surfaced via onError', async () => {
    const socket = new FakeSocket();
    const tx = initiator(socket);
    const p = tx.connect();
    socket.open();
    await p;
    const errors: unknown[] = [];
    tx.onError(e => errors.push(e));
    socket.fail(new Error('mid-session'));
    expect(errors).toHaveLength(1);
  });

  it('a post-open close is surfaced via onError', async () => {
    const socket = new FakeSocket();
    const tx = initiator(socket);
    const p = tx.connect();
    socket.open();
    await p;
    const errors: unknown[] = [];
    tx.onError(e => errors.push(e));
    socket.remoteClose();
    expect(errors).toHaveLength(1);
  });

  it('close() detaches handlers, closes the socket, and silences send (idempotent)', async () => {
    const socket = new FakeSocket();
    const tx = initiator(socket);
    const p = tx.connect();
    socket.open();
    await p;
    tx.close();
    tx.close(); // idempotent
    expect(socket.closed).toBe(true);
    // A send after close is a no-op (not thrown, not framed).
    tx.send(offer('initiator'));
    expect(socket.sent).toHaveLength(0);
    // No further inbound delivery after close.
    const received: SignalingMessage[] = [];
    tx.onMessage(m => received.push(m));
    expect(received).toHaveLength(0);
  });

  it('connect() after close() rejects', async () => {
    const socket = new FakeSocket();
    const tx = initiator(socket);
    tx.close();
    await expect(tx.connect()).rejects.toThrow(/already closed/);
  });

  it('unsubscribe stops further message delivery', async () => {
    const socket = new FakeSocket();
    const tx = initiator(socket);
    const p = tx.connect();
    socket.open();
    await p;
    const received: SignalingMessage[] = [];
    const off = tx.onMessage(m => received.push(m));
    off();
    socket.deliver(offer('responder'));
    expect(received).toHaveLength(0);
  });
});

describe('responder transport (listen seam)', () => {
  it('throws by default — no JS WebSocket server in RN', () => {
    expect(() =>
      createLocalSocketTransport({
        host: '0.0.0.0',
        port: 8443,
        sessionId: SID,
        role: 'responder',
      }),
    ).toThrow(/no local WebSocket SERVER/);
  });
});
