/**
 * Unit tests for the native-backed baby-side LISTEN transports (DMY-72).
 *
 * The behavioural AC (two phones actually receiving frames from one baby) is a
 * device milestone. Here we cover the CONTRACT against an INJECTED fake native
 * SignalingServer:
 *  - createNativeBroadcastTransport returns undefined when the native module is
 *    absent (inert — preserves the DMY-66 fan-out's "no transport" posture);
 *  - start() threads the shared secret (sessionId) + default port into the
 *    native start();
 *  - an accepted client surfaces a per-client SignalingTransport via
 *    onClientConnect; its send routes to the native send for THAT client; an
 *    inbound native message is parsed + delivered; a native onClose fires
 *    onClientDisconnect and surfaces a transport error;
 *  - close() tears the native server down;
 *  - the 1:1 factory throws when the module is absent (matching the default seam)
 *    and resolves connect() on the first accepted parent when present.
 */
import {
  createNativeBroadcastTransport,
  createNativeSignalingServerFactory,
  createPerClientTransport,
  DEFAULT_SIGNALING_PORT,
} from '../signalingServerNative';
import type {
  NativeSignalingServerModule,
  SignalingServerHandlers,
  SignalingServer,
} from '../../../native/signalingServer';
import type { SignalingMessage, SignalingTransport } from '../signalingTypes';

/**
 * A fake SignalingServer + a `createServer` shim that CAPTURES the handlers the
 * module wires, so a test can drive connection/message/close events
 * synchronously. This bypasses the native module + NativeEventEmitter entirely
 * (those are covered by signalingServer.test.ts).
 */
function fakeServer() {
  let handlers: SignalingServerHandlers = {};
  const sent: Array<{ clientId: string; message: string }> = [];
  const closedClients: string[] = [];

  const server: SignalingServer = {
    start: jest.fn((params: { port: number; sessionId: string }) =>
      Promise.resolve(params.port),
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
    server,
    /** Pass as `createServer`: records the handlers + returns the fake server. */
    createServer: (h: SignalingServerHandlers): SignalingServer => {
      handlers = h;
      return server;
    },
    get handlers() {
      return handlers;
    },
    sent,
    closedClients,
  };
}

const OFFER: SignalingMessage = {
  type: 'offer',
  sessionId: 's-1',
  from: 'initiator',
  description: { type: 'offer', sdp: 'x' },
};

describe('createPerClientTransport', () => {
  function fakeServerSlice() {
    const send = jest.fn();
    const closeClient = jest.fn();
    return { send, closeClient };
  }

  it('connect() resolves immediately (socket already accepted)', async () => {
    const t = createPerClientTransport('c-1', fakeServerSlice());
    await expect(t.connect()).resolves.toBeUndefined();
  });

  it('send routes a JSON frame to THIS client', () => {
    const slice = fakeServerSlice();
    const t = createPerClientTransport('c-1', slice);
    t.send(OFFER);
    expect(slice.send).toHaveBeenCalledWith('c-1', JSON.stringify(OFFER));
  });

  it('delivers a valid inbound frame to onMessage subscribers', () => {
    const t = createPerClientTransport('c-1', fakeServerSlice());
    const onMessage = jest.fn();
    t.onMessage(onMessage);
    t.__deliverRaw(JSON.stringify(OFFER));
    expect(onMessage).toHaveBeenCalledWith(OFFER);
  });

  it('drops a malformed inbound frame without throwing', () => {
    const t = createPerClientTransport('c-1', fakeServerSlice());
    const onMessage = jest.fn();
    t.onMessage(onMessage);
    expect(() => t.__deliverRaw('not json')).not.toThrow();
    expect(() => t.__deliverRaw('{"type":"garbage"}')).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('__socketClosed surfaces a transport error and stops delivery', () => {
    const t = createPerClientTransport('c-1', fakeServerSlice());
    const onError = jest.fn();
    const onMessage = jest.fn();
    t.onError(onError);
    t.onMessage(onMessage);

    t.__socketClosed();

    expect(onError).toHaveBeenCalledTimes(1);
    // No further delivery after a socket close.
    t.__deliverRaw(JSON.stringify(OFFER));
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('close() closes the client socket and silences further send', () => {
    const slice = fakeServerSlice();
    const t = createPerClientTransport('c-1', slice);
    t.close();
    expect(slice.closeClient).toHaveBeenCalledWith('c-1');
    t.send(OFFER);
    expect(slice.send).not.toHaveBeenCalled();
  });
});

describe('createNativeBroadcastTransport (native absent → inert)', () => {
  it('returns undefined when no native module / server is available', () => {
    // No `server` injected and the (Jest) native module is absent.
    const transport = createNativeBroadcastTransport({ sessionId: 's-1' });
    expect(transport).toBeUndefined();
  });
});

describe('createNativeBroadcastTransport (server injected)', () => {
  it('start() threads the secret + default port into the native start', async () => {
    const fake = fakeServer();
    const transport = createNativeBroadcastTransport({
      sessionId: 's-secret',
      createServer: fake.createServer,
    })!;
    await transport.start();
    expect(fake.server.start).toHaveBeenCalledWith({
      port: DEFAULT_SIGNALING_PORT,
      sessionId: 's-secret',
    });
  });

  it('start() honours an explicit port override', async () => {
    const fake = fakeServer();
    const transport = createNativeBroadcastTransport({
      sessionId: 's-1',
      port: 9000,
      createServer: fake.createServer,
    })!;
    await transport.start();
    expect(fake.server.start).toHaveBeenCalledWith({
      port: 9000,
      sessionId: 's-1',
    });
  });

  it('close() tears the native server down', () => {
    const fake = fakeServer();
    const transport = createNativeBroadcastTransport({
      sessionId: 's-1',
      createServer: fake.createServer,
    })!;
    transport.close();
    expect(fake.server.stop).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when createServer yields no server (inert)', () => {
    const transport = createNativeBroadcastTransport({
      sessionId: 's-1',
      createServer: () => undefined,
    });
    expect(transport).toBeUndefined();
  });
});

describe('createNativeBroadcastTransport — accept loop (end to end)', () => {
  it('surfaces an accepted client as a per-client transport via onClientConnect', () => {
    const fake = fakeServer();
    const transport = createNativeBroadcastTransport({
      sessionId: 's-1',
      createServer: fake.createServer,
    })!;
    const onConnect = jest.fn();
    transport.onClientConnect(onConnect);

    fake.handlers.onConnection?.({ clientId: 'c-1' });

    expect(onConnect).toHaveBeenCalledTimes(1);
    const [clientId, perClient] = onConnect.mock.calls[0];
    expect(clientId).toBe('c-1');
    expect(typeof (perClient as SignalingTransport).send).toBe('function');
  });

  it('routes a per-client send to the native send for THAT client', () => {
    const fake = fakeServer();
    const transport = createNativeBroadcastTransport({
      sessionId: 's-1',
      createServer: fake.createServer,
    })!;
    let perClient: SignalingTransport | undefined;
    transport.onClientConnect((_id, t) => {
      perClient = t;
    });
    fake.handlers.onConnection?.({ clientId: 'c-1' });

    perClient!.send(OFFER);

    expect(fake.sent).toEqual([
      { clientId: 'c-1', message: JSON.stringify(OFFER) },
    ]);
  });

  it('delivers a native message to the matching client transport', () => {
    const fake = fakeServer();
    const transport = createNativeBroadcastTransport({
      sessionId: 's-1',
      createServer: fake.createServer,
    })!;
    let perClient: SignalingTransport | undefined;
    transport.onClientConnect((_id, t) => {
      perClient = t;
    });
    fake.handlers.onConnection?.({ clientId: 'c-1' });
    const onMessage = jest.fn();
    perClient!.onMessage(onMessage);

    fake.handlers.onMessage?.({ clientId: 'c-1', data: JSON.stringify(OFFER) });

    expect(onMessage).toHaveBeenCalledWith(OFFER);
  });

  it('a native onClose fires onClientDisconnect and a transport error', () => {
    const fake = fakeServer();
    const transport = createNativeBroadcastTransport({
      sessionId: 's-1',
      createServer: fake.createServer,
    })!;
    let perClient: SignalingTransport | undefined;
    transport.onClientConnect((_id, t) => {
      perClient = t;
    });
    const onDisconnect = jest.fn();
    transport.onClientDisconnect!(onDisconnect);
    fake.handlers.onConnection?.({ clientId: 'c-1' });
    const onError = jest.fn();
    perClient!.onError(onError);

    fake.handlers.onClose?.({ clientId: 'c-1' });

    expect(onDisconnect).toHaveBeenCalledWith('c-1');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('ignores a duplicate onConnection for the same clientId', () => {
    const fake = fakeServer();
    const transport = createNativeBroadcastTransport({
      sessionId: 's-1',
      createServer: fake.createServer,
    })!;
    const onConnect = jest.fn();
    transport.onClientConnect(onConnect);

    fake.handlers.onConnection?.({ clientId: 'c-1' });
    fake.handlers.onConnection?.({ clientId: 'c-1' });

    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});

describe('createNativeSignalingServerFactory', () => {
  it('throws when the native module is absent (matches the default seam)', () => {
    const factory = createNativeSignalingServerFactory('s-1', 8443, undefined);
    expect(() =>
      factory({
        host: '0.0.0.0',
        port: 8443,
        sessionId: 's-1',
        role: 'responder',
      }),
    ).toThrow(/native SignalingServer module is not available/);
  });

  it('builds a 1:1 transport when a native module is present', () => {
    const native: NativeSignalingServerModule = {
      start: jest.fn(() => Promise.resolve(8443)),
      send: jest.fn(),
      closeClient: jest.fn(),
      stop: jest.fn(() => Promise.resolve()),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    // createSignalingServer will build a real NativeEventEmitter over `native`;
    // that requires RN's native emitter. To avoid it we only assert the factory
    // does NOT throw when the module resolves — the per-client routing is
    // covered by createPerClientTransport tests.
    let transport: SignalingTransport | undefined;
    expect(() => {
      transport = createNativeSignalingServerFactory('s-1', 8443, native)({
        host: '0.0.0.0',
        port: 8443,
        sessionId: 's-1',
        role: 'responder',
      });
    }).not.toThrow();
    expect(transport).toBeDefined();
    // Tear down so the emitter subscriptions are dropped.
    transport?.close();
  });
});
