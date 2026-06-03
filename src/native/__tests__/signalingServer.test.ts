/**
 * Unit tests for the native SignalingServer JS wrapper (DMY-72).
 *
 * The behavioural AC (a parent on another phone actually dials in and the WS
 * upgrade/secret check passes) is a device milestone unachievable under Jest.
 * Here we cover the CONTRACT against a fake native module + fake emitter:
 *  - createSignalingServer returns undefined when the module is absent (inert);
 *  - it subscribes the provided handlers to the right event names and forwards
 *    payloads;
 *  - start() resolves with the native bound port; send/closeClient/stop route to
 *    the native module;
 *  - stop() drops every subscription and is idempotent; a late native event after
 *    stop() does not reach a handler;
 *  - resolveSignalingServerModule shape-checks the native object.
 */
import { NativeModules, Platform } from 'react-native';

import {
  type NativeSignalingServerModule,
  SIGNALING_SERVER_EVENTS,
  createSignalingServer,
  resolveSignalingServerModule,
} from '../signalingServer';

/** A native-module test double with jest-mock methods. */
function mockNative(
  overrides: Partial<NativeSignalingServerModule> = {},
): NativeSignalingServerModule {
  return {
    start: jest.fn(() => Promise.resolve(8443)),
    send: jest.fn(),
    closeClient: jest.fn(),
    stop: jest.fn(() => Promise.resolve()),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
    ...overrides,
  };
}

/**
 * A fake NativeEventEmitter: records listeners by event name and lets a test
 * drive them synchronously, plus tracks `remove()` calls per subscription.
 */
function fakeEmitter() {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  const removed: string[] = [];
  return {
    addListener: jest.fn((name: string, handler: (e: unknown) => void) => {
      const arr = listeners.get(name) ?? [];
      arr.push(handler);
      listeners.set(name, arr);
      return {
        remove: jest.fn(() => {
          removed.push(name);
        }),
      };
    }),
    emit(name: string, payload: unknown) {
      for (const h of listeners.get(name) ?? []) {
        h(payload);
      }
    },
    removed,
    listeners,
  };
}

describe('createSignalingServer (native absent → inert)', () => {
  it('returns undefined when the native module is missing', () => {
    const server = createSignalingServer({}, undefined);
    expect(server).toBeUndefined();
  });
});

describe('createSignalingServer (native present)', () => {
  it('subscribes the provided handlers to the right event names', () => {
    const native = mockNative();
    const emitter = fakeEmitter();
    createSignalingServer(
      { onConnection: jest.fn(), onMessage: jest.fn() },
      native,
      emitter,
    );
    const names = emitter.addListener.mock.calls.map(c => c[0]);
    expect(names).toContain(SIGNALING_SERVER_EVENTS.connection);
    expect(names).toContain(SIGNALING_SERVER_EVENTS.message);
    // No close/error handler passed → not subscribed.
    expect(names).not.toContain(SIGNALING_SERVER_EVENTS.close);
    expect(names).not.toContain(SIGNALING_SERVER_EVENTS.error);
  });

  it('forwards a connection event payload to onConnection', () => {
    const native = mockNative();
    const emitter = fakeEmitter();
    const onConnection = jest.fn();
    createSignalingServer({ onConnection }, native, emitter);

    emitter.emit(SIGNALING_SERVER_EVENTS.connection, { clientId: 'c-1' });

    expect(onConnection).toHaveBeenCalledWith({ clientId: 'c-1' });
  });

  it('forwards a message event payload to onMessage', () => {
    const native = mockNative();
    const emitter = fakeEmitter();
    const onMessage = jest.fn();
    createSignalingServer({ onMessage }, native, emitter);

    emitter.emit(SIGNALING_SERVER_EVENTS.message, {
      clientId: 'c-1',
      data: '{"type":"offer"}',
    });

    expect(onMessage).toHaveBeenCalledWith({
      clientId: 'c-1',
      data: '{"type":"offer"}',
    });
  });

  it('isolates a throwing handler so it never breaks delivery', () => {
    const native = mockNative();
    const emitter = fakeEmitter();
    const onConnection = jest.fn(() => {
      throw new Error('boom');
    });
    createSignalingServer({ onConnection }, native, emitter);

    expect(() =>
      emitter.emit(SIGNALING_SERVER_EVENTS.connection, { clientId: 'c-1' }),
    ).not.toThrow();
  });

  it('start() resolves with the native bound port', async () => {
    const native = mockNative({ start: jest.fn(() => Promise.resolve(8445)) });
    const emitter = fakeEmitter();
    const server = createSignalingServer({}, native, emitter)!;

    await expect(
      server.start({ port: 8443, sessionId: 's-1' }),
    ).resolves.toBe(8445);
    expect(native.start).toHaveBeenCalledWith({ port: 8443, sessionId: 's-1' });
  });

  it('send/closeClient route to the native module', () => {
    const native = mockNative();
    const emitter = fakeEmitter();
    const server = createSignalingServer({}, native, emitter)!;

    server.send('c-1', '{"type":"answer"}');
    server.closeClient('c-1');

    expect(native.send).toHaveBeenCalledWith('c-1', '{"type":"answer"}');
    expect(native.closeClient).toHaveBeenCalledWith('c-1');
  });

  it('swallows a native send throw (best-effort)', () => {
    const native = mockNative({
      send: jest.fn(() => {
        throw new Error('gone');
      }),
    });
    const emitter = fakeEmitter();
    const server = createSignalingServer({}, native, emitter)!;

    expect(() => server.send('c-1', 'x')).not.toThrow();
  });

  it('stop() drops every subscription, calls native stop, and is idempotent', () => {
    const native = mockNative();
    const emitter = fakeEmitter();
    const server = createSignalingServer(
      { onConnection: jest.fn(), onMessage: jest.fn() },
      native,
      emitter,
    )!;

    server.stop();
    server.stop();

    // Both subscriptions removed.
    expect(emitter.removed).toContain(SIGNALING_SERVER_EVENTS.connection);
    expect(emitter.removed).toContain(SIGNALING_SERVER_EVENTS.message);
    expect(native.stop).toHaveBeenCalledTimes(1);
  });

  it('send/closeClient are no-ops after stop()', () => {
    const native = mockNative();
    const emitter = fakeEmitter();
    const server = createSignalingServer({}, native, emitter)!;

    server.stop();
    server.send('c-1', 'x');
    server.closeClient('c-1');

    expect(native.send).not.toHaveBeenCalled();
    expect(native.closeClient).not.toHaveBeenCalled();
  });

  it('start() rejects after stop()', async () => {
    const native = mockNative();
    const emitter = fakeEmitter();
    const server = createSignalingServer({}, native, emitter)!;

    server.stop();
    await expect(
      server.start({ port: 8443, sessionId: 's-1' }),
    ).rejects.toThrow(/already stopped/);
  });
});

describe('resolveSignalingServerModule', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
    delete (NativeModules as Record<string, unknown>).SignalingServer;
  });

  it('returns the module when start/send/closeClient/stop are present', () => {
    Platform.OS = 'ios';
    const native = mockNative();
    (NativeModules as Record<string, unknown>).SignalingServer = native;

    expect(resolveSignalingServerModule()).toBe(native);
  });

  it('returns undefined when the module is not registered', () => {
    Platform.OS = 'android';
    delete (NativeModules as Record<string, unknown>).SignalingServer;

    expect(resolveSignalingServerModule()).toBeUndefined();
  });

  it('returns undefined when a registered object lacks methods', () => {
    Platform.OS = 'ios';
    (NativeModules as Record<string, unknown>).SignalingServer = {
      start: 'not a function',
    };

    expect(resolveSignalingServerModule()).toBeUndefined();
  });
});
