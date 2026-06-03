/**
 * Supplementary unit tests for signalingServerNative (DMY-72), added by QA to
 * close JS-logic coverage gaps left by signalingServerNative.test.ts:
 *
 *  - the 1:1 createNativeSignalingServerFactory ROUTING (connect resolves on the
 *    first parent, send routes to the active client, inbound frames are parsed +
 *    delivered, extra dials are ignored, onClose surfaces a transport error,
 *    a listener onError rejects a pending connect, close() tears down + silences).
 *    The factory builds its server via createSignalingServer(handlers, native)
 *    with NO emitter seam, so we mock createSignalingServer to capture handlers
 *    and drive the native events synchronously — no NativeEventEmitter needed.
 *  - multi-client ISOLATION on the broadcast accept loop (two parents: a frame /
 *    send for one never reaches the other; one dropping leaves the other live);
 *  - remaining broadcast-loop branches: onClose for an unknown client (no-op),
 *    start() idempotency, post-close inertness, unsubscribe closures.
 *
 * No production code is touched.
 */
import type {
  SignalingServer,
  SignalingServerHandlers,
} from '../../../native/signalingServer';
import type { SignalingMessage, SignalingTransport } from '../signalingTypes';

// Mock the native wrapper so the 1:1 factory (which calls createSignalingServer
// with no emitter override) is driven through a captured-handlers fake instead
// of a real NativeEventEmitter. resolveSignalingServerModule is re-exported so
// the broadcast path's default still resolves to "absent" (undefined) under Jest.
jest.mock('../../../native/signalingServer', () => {
  const actual = jest.requireActual('../../../native/signalingServer');
  return {
    ...actual,
    createSignalingServer: jest.fn(),
  };
});

import { createSignalingServer } from '../../../native/signalingServer';
import {
  createNativeBroadcastTransport,
  createNativeSignalingServerFactory,
} from '../signalingServerNative';

const createSignalingServerMock = createSignalingServer as jest.MockedFunction<
  typeof createSignalingServer
>;

/**
 * A fake SignalingServer that captures the handlers wired by the module under
 * test, so a test drives onConnection/onMessage/onClose/onError synchronously.
 */
function fakeServer() {
  let handlers: SignalingServerHandlers = {};
  const server: SignalingServer = {
    start: jest.fn((params: { port: number; sessionId: string }) =>
      Promise.resolve(params.port),
    ),
    send: jest.fn(),
    closeClient: jest.fn(),
    stop: jest.fn(),
  };
  return {
    server,
    install(): void {
      createSignalingServerMock.mockImplementation(h => {
        handlers = h;
        return server;
      });
    },
    installAbsent(): void {
      createSignalingServerMock.mockReturnValue(undefined);
    },
    get handlers() {
      return handlers;
    },
  };
}

const OFFER: SignalingMessage = {
  type: 'offer',
  sessionId: 's-1',
  from: 'initiator',
  description: { type: 'offer', sdp: 'x' },
};
const ANSWER: SignalingMessage = {
  type: 'answer',
  sessionId: 's-1',
  from: 'responder',
  description: { type: 'answer', sdp: 'y' },
};

afterEach(() => {
  createSignalingServerMock.mockReset();
});

describe('createNativeSignalingServerFactory — 1:1 routing', () => {
  function build() {
    const fake = fakeServer();
    fake.install();
    const transport = createNativeSignalingServerFactory('s-1', 8443, {
      start: jest.fn(() => Promise.resolve(8443)),
      send: jest.fn(),
      closeClient: jest.fn(),
      stop: jest.fn(() => Promise.resolve()),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    })({
      host: '0.0.0.0',
      port: 8443,
      sessionId: 's-1',
      role: 'responder',
    });
    return { fake, transport };
  }

  it('connect() stays pending until the FIRST parent is accepted, then resolves', async () => {
    const { fake, transport } = build();
    let resolved = false;
    const p = transport.connect().then(() => {
      resolved = true;
    });
    // start() threaded the secret + port.
    expect(fake.server.start).toHaveBeenCalledWith({ port: 8443, sessionId: 's-1' });
    await Promise.resolve();
    expect(resolved).toBe(false);

    fake.handlers.onConnection?.({ clientId: 'c-1' });
    await p;
    expect(resolved).toBe(true);
  });

  it('send routes a JSON frame to the active client; no-op before any parent', () => {
    const { fake, transport } = build();
    // Before a parent is accepted, send is a no-op.
    transport.send(ANSWER);
    expect(fake.server.send).not.toHaveBeenCalled();

    fake.handlers.onConnection?.({ clientId: 'c-1' });
    transport.send(ANSWER);
    expect(fake.server.send).toHaveBeenCalledWith('c-1', JSON.stringify(ANSWER));
  });

  it('delivers a valid inbound frame from the active client; drops others/garbage', () => {
    const { fake, transport } = build();
    const onMessage = jest.fn();
    transport.onMessage(onMessage);
    fake.handlers.onConnection?.({ clientId: 'c-1' });

    // A frame from a different client id is ignored (1:1 is bound to c-1).
    fake.handlers.onMessage?.({ clientId: 'c-2', data: JSON.stringify(OFFER) });
    expect(onMessage).not.toHaveBeenCalled();

    // Garbage from the active client is dropped, not thrown.
    expect(() =>
      fake.handlers.onMessage?.({ clientId: 'c-1', data: 'not json' }),
    ).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();

    fake.handlers.onMessage?.({ clientId: 'c-1', data: JSON.stringify(OFFER) });
    expect(onMessage).toHaveBeenCalledWith(OFFER);
  });

  it('ignores extra dials once one parent is bound (1:1)', () => {
    const { fake, transport } = build();
    const onMessage = jest.fn();
    transport.onMessage(onMessage);
    fake.handlers.onConnection?.({ clientId: 'c-1' });
    fake.handlers.onConnection?.({ clientId: 'c-2' });

    // The second client never becomes active: its frames stay ignored.
    fake.handlers.onMessage?.({ clientId: 'c-2', data: JSON.stringify(OFFER) });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('onClose for the active client surfaces a transport error', () => {
    const { fake, transport } = build();
    const onError = jest.fn();
    transport.onError(onError);
    fake.handlers.onConnection?.({ clientId: 'c-1' });

    fake.handlers.onClose?.({ clientId: 'c-1' });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a listener onError rejects a PENDING connect()', async () => {
    const { fake, transport } = build();
    const p = transport.connect();
    fake.handlers.onError?.({ message: 'bind failed' });
    await expect(p).rejects.toThrow(/native server error/);
  });

  it('a listener onError after connect resolved surfaces a transport error', async () => {
    const { fake, transport } = build();
    const onError = jest.fn();
    transport.onError(onError);
    const p = transport.connect();
    fake.handlers.onConnection?.({ clientId: 'c-1' });
    await p;

    fake.handlers.onError?.({ message: 'accept loop error' });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('close() tears the server down and silences further send', () => {
    const { fake, transport } = build();
    fake.handlers.onConnection?.({ clientId: 'c-1' });
    transport.close();
    expect(fake.server.stop).toHaveBeenCalledTimes(1);

    transport.send(ANSWER);
    expect(fake.server.send).not.toHaveBeenCalled();
  });

  it('connect() rejects after close()', async () => {
    const { transport } = build();
    transport.close();
    await expect(transport.connect()).rejects.toThrow(/already closed/);
  });

  it('throws when createSignalingServer yields no server (inert/absent module)', () => {
    const fake = fakeServer();
    fake.installAbsent();
    expect(() =>
      createNativeSignalingServerFactory('s-1', 8443, {
        start: jest.fn(() => Promise.resolve(8443)),
        send: jest.fn(),
        closeClient: jest.fn(),
        stop: jest.fn(() => Promise.resolve()),
        addListener: jest.fn(),
        removeListeners: jest.fn(),
      })({ host: '0.0.0.0', port: 8443, sessionId: 's-1', role: 'responder' }),
    ).toThrow(/native SignalingServer module is not available/);
  });
});

describe('createNativeBroadcastTransport — multi-client isolation', () => {
  // These use the createServer injection seam directly (not the mocked import),
  // exercising the real accept-loop wiring across TWO parents.
  function fakeBroadcastServer() {
    let handlers: SignalingServerHandlers = {};
    const sent: Array<{ clientId: string; message: string }> = [];
    const closedClients: string[] = [];
    const server: SignalingServer = {
      start: jest.fn((p: { port: number; sessionId: string }) =>
        Promise.resolve(p.port),
      ),
      send: jest.fn((clientId: string, message: string) => {
        sent.push({ clientId, message });
      }),
      closeClient: jest.fn((clientId: string) => {
        closedClients.push(clientId);
      }),
      stop: jest.fn(),
    };
    return {
      createServer: (h: SignalingServerHandlers): SignalingServer => {
        handlers = h;
        return server;
      },
      server,
      get handlers() {
        return handlers;
      },
      sent,
      closedClients,
    };
  }

  function twoClients() {
    const fake = fakeBroadcastServer();
    const transport = createNativeBroadcastTransport({
      sessionId: 's-1',
      createServer: fake.createServer,
    })!;
    const seen = new Map<string, SignalingTransport>();
    transport.onClientConnect((id, t) => seen.set(id, t));
    fake.handlers.onConnection?.({ clientId: 'c-1' });
    fake.handlers.onConnection?.({ clientId: 'c-2' });
    return { fake, transport, a: seen.get('c-1')!, b: seen.get('c-2')! };
  }

  it('a send for one client never reaches the other', () => {
    const { fake, a, b } = twoClients();
    a.send(OFFER);
    b.send(ANSWER);
    expect(fake.sent).toEqual([
      { clientId: 'c-1', message: JSON.stringify(OFFER) },
      { clientId: 'c-2', message: JSON.stringify(ANSWER) },
    ]);
  });

  it('an inbound frame is delivered ONLY to the matching client', () => {
    const { fake, a, b } = twoClients();
    const onA = jest.fn();
    const onB = jest.fn();
    a.onMessage(onA);
    b.onMessage(onB);

    fake.handlers.onMessage?.({ clientId: 'c-1', data: JSON.stringify(OFFER) });
    expect(onA).toHaveBeenCalledWith(OFFER);
    expect(onB).not.toHaveBeenCalled();
  });

  it('one client dropping leaves the other live (isolated teardown)', () => {
    const { fake, a, b } = twoClients();
    const onBMsg = jest.fn();
    b.onMessage(onBMsg);

    fake.handlers.onClose?.({ clientId: 'c-1' });

    // c-2 still receives frames after c-1 dropped.
    fake.handlers.onMessage?.({ clientId: 'c-2', data: JSON.stringify(ANSWER) });
    expect(onBMsg).toHaveBeenCalledWith(ANSWER);
    // c-1's transport is dead: a late send is silenced.
    a.send(OFFER);
    expect(fake.sent.some(s => s.clientId === 'c-1')).toBe(false);
  });

  it('onClose for an UNKNOWN client is a no-op (no disconnect fired)', () => {
    const fresh = fakeBroadcastServer();
    const t = createNativeBroadcastTransport({
      sessionId: 's-1',
      createServer: fresh.createServer,
    })!;
    const onDisc = jest.fn();
    t.onClientDisconnect?.(onDisc);
    fresh.handlers.onClose?.({ clientId: 'ghost' });
    expect(onDisc).not.toHaveBeenCalled();
  });

  it('start() is idempotent and inert after close()', async () => {
    const fake = fakeBroadcastServer();
    const t = createNativeBroadcastTransport({
      sessionId: 's-1',
      createServer: fake.createServer,
    })!;
    await t.start();
    await t.start();
    expect(fake.server.start).toHaveBeenCalledTimes(1);

    t.close();
    await t.start();
    expect(fake.server.start).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing a connect/disconnect handler stops further calls', () => {
    const fake = fakeBroadcastServer();
    const t = createNativeBroadcastTransport({
      sessionId: 's-1',
      createServer: fake.createServer,
    })!;
    const onConnect = jest.fn();
    const off = t.onClientConnect(onConnect);
    off();
    fake.handlers.onConnection?.({ clientId: 'c-1' });
    expect(onConnect).not.toHaveBeenCalled();
  });
});
