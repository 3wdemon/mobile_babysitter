/**
 * Unit tests for the AudioPlayback routing abstraction (DMY-18).
 *
 * The no-op is the shipped default (real routing/VoIP-session is DMY-9). The
 * safe wrapper must forward calls to a real controller and never throw, so a
 * flaky routing backend can never crash a monitoring session.
 */
import {
  AUDIO_ROUTES,
  availableRoutesFor,
  createAudioSessionPlayback,
  createSafeAudioPlayback,
  noopAudioPlayback,
} from '../audioPlayback';
import type { AudioPlayback, AudioRoute, AudioSession } from '../audioPlayback';
import type { MediaStreamLike } from '../mediaTypes';

const fakeStream: MediaStreamLike = { getTracks: () => [] };

/** A controller exposing every method as a jest mock, for forwarding asserts. */
function mockPlayback(overrides: Partial<AudioPlayback> = {}): AudioPlayback {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    setMuted: jest.fn(),
    setRoute: jest.fn(),
    isBluetoothAvailable: jest.fn(() => false),
    getAvailableRoutes: jest.fn(() => availableRoutesFor(false)),
    ...overrides,
  };
}

describe('noopAudioPlayback', () => {
  it('never throws', () => {
    expect(() => {
      noopAudioPlayback.start(fakeStream);
      noopAudioPlayback.setMuted(true);
      noopAudioPlayback.stop();
    }).not.toThrow();
  });

  it('setRoute is a safe no-op for every route and does not throw (Jest)', () => {
    expect(() => {
      for (const route of AUDIO_ROUTES) {
        noopAudioPlayback.setRoute(route);
      }
    }).not.toThrow();
    // Returns undefined (sync no-op), never a rejected promise.
    expect(noopAudioPlayback.setRoute('speaker')).toBeUndefined();
  });

  it('reports Bluetooth unavailable and offers only speaker + earpiece', () => {
    expect(noopAudioPlayback.isBluetoothAvailable()).toBe(false);
    expect(noopAudioPlayback.getAvailableRoutes()).toEqual([
      'speaker',
      'earpiece',
    ]);
  });
});

describe('availableRoutesFor', () => {
  it('includes Bluetooth only when available', () => {
    expect(availableRoutesFor(true)).toEqual(['speaker', 'earpiece', 'bluetooth']);
    expect(availableRoutesFor(false)).toEqual(['speaker', 'earpiece']);
  });
});

describe('createSafeAudioPlayback', () => {
  it('forwards start/stop/setMuted to the wrapped controller', () => {
    const inner = mockPlayback();
    const safe = createSafeAudioPlayback(inner);

    safe.start(fakeStream);
    safe.setMuted(true);
    safe.stop();

    expect(inner.start).toHaveBeenCalledWith(fakeStream);
    expect(inner.setMuted).toHaveBeenCalledWith(true);
    expect(inner.stop).toHaveBeenCalledTimes(1);
  });

  it('forwards setRoute to the wrapped controller with the chosen route', () => {
    const inner = mockPlayback();
    const safe = createSafeAudioPlayback(inner);

    safe.setRoute('earpiece');

    expect(inner.setRoute).toHaveBeenCalledWith('earpiece');
  });

  it('forwards Bluetooth availability + available routes from the controller', () => {
    const inner = mockPlayback({
      isBluetoothAvailable: jest.fn(() => true),
      getAvailableRoutes: jest.fn(() => availableRoutesFor(true)),
    });
    const safe = createSafeAudioPlayback(inner);

    expect(safe.isBluetoothAvailable()).toBe(true);
    expect(safe.getAvailableRoutes()).toEqual(AUDIO_ROUTES);
  });

  it('swallows errors from a throwing controller', () => {
    const inner = mockPlayback({
      start: jest.fn(() => {
        throw new Error('routing failed');
      }),
      stop: jest.fn(() => {
        throw new Error('release failed');
      }),
      setMuted: jest.fn(() => {
        throw new Error('mute failed');
      }),
      setRoute: jest.fn(() => {
        throw new Error('route failed');
      }),
      isBluetoothAvailable: jest.fn(() => {
        throw new Error('bt probe failed');
      }),
      getAvailableRoutes: jest.fn(() => {
        throw new Error('routes failed');
      }),
    });
    const safe = createSafeAudioPlayback(inner);
    expect(() => safe.start(fakeStream)).not.toThrow();
    expect(() => safe.setMuted(true)).not.toThrow();
    expect(() => safe.stop()).not.toThrow();
    expect(() => safe.setRoute('bluetooth')).not.toThrow();
    // Failing capability probes degrade safely, never throw.
    expect(safe.isBluetoothAvailable()).toBe(false);
    expect(safe.getAvailableRoutes()).toEqual(availableRoutesFor(false));
  });

  it('swallows a REJECTED promise from an async setRoute', async () => {
    const inner = mockPlayback({
      setRoute: jest.fn(() => Promise.reject(new Error('async route failed'))),
    });
    const safe = createSafeAudioPlayback(inner);
    // Must not reject — the wrapper absorbs the async failure.
    await expect(safe.setRoute('speaker')).resolves.toBeUndefined();
  });

  it('defaults to the no-op controller when none is provided', () => {
    const safe = createSafeAudioPlayback();
    expect(() => safe.start(fakeStream)).not.toThrow();
    expect(() => safe.setRoute('speaker')).not.toThrow();
    expect(safe.isBluetoothAvailable()).toBe(false);
  });
});

describe('createAudioSessionPlayback (real-controller scaffold)', () => {
  it('delegates route control + availability to the native session', () => {
    const applied: AudioRoute[] = [];
    const session: AudioSession = {
      applyRoute: jest.fn((route: AudioRoute) => {
        applied.push(route);
      }),
      hasBluetooth: jest.fn(() => true),
    };
    const playback = createAudioSessionPlayback(session);

    playback.setRoute('bluetooth');

    expect(session.applyRoute).toHaveBeenCalledWith('bluetooth');
    expect(applied).toEqual(['bluetooth']);
    expect(playback.isBluetoothAvailable()).toBe(true);
    expect(playback.getAvailableRoutes()).toEqual(AUDIO_ROUTES);
  });

  it('hides Bluetooth in available routes when the session reports none', () => {
    const session: AudioSession = {
      applyRoute: jest.fn(),
      hasBluetooth: jest.fn(() => false),
    };
    const playback = createAudioSessionPlayback(session);
    expect(playback.getAvailableRoutes()).toEqual(['speaker', 'earpiece']);
  });
});
