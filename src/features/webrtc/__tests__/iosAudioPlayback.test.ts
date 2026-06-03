/**
 * Unit tests for the iOS background-audio AudioPlayback (DMY-48).
 *
 * AC1 (30 min locked, real device) is behavioral and unachievable under Jest;
 * here we cover the CONTRACT: start() activates the AVAudioSession, stop()
 * deactivates it, and an ABSENT native module (Android / Jest) degrades to a
 * safe no-op that never throws (AC2). The native Swift session is asserted by
 * the manual device check documented in the PR.
 */
import { NativeModules, Platform } from 'react-native';

import { AUDIO_ROUTES } from '../audioPlayback';
import {
  type AudioSessionNativeModule,
  createIosAudioPlayback,
  createIosAudioSessionPlayback,
  resolveAudioSessionModule,
} from '../iosAudioPlayback';
import type { MediaStreamLike } from '../mediaTypes';

const fakeStream: MediaStreamLike = { getTracks: () => [] };

/** A native-module test double whose activate/deactivate are jest mocks. */
function mockNative(
  overrides: Partial<AudioSessionNativeModule> = {},
): AudioSessionNativeModule {
  return {
    activate: jest.fn(() => Promise.resolve()),
    deactivate: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

/** Flush pending microtasks so a guarded promise's .catch can run. */
const flush = () => Promise.resolve();

describe('createIosAudioSessionPlayback (native present)', () => {
  it('start() activates the AVAudioSession (AC1 contract)', () => {
    const native = mockNative();
    const playback = createIosAudioSessionPlayback(native);

    playback.start(fakeStream);

    expect(native.activate).toHaveBeenCalledTimes(1);
    expect(native.deactivate).not.toHaveBeenCalled();
  });

  it('stop() deactivates the AVAudioSession (AC3 teardown)', () => {
    const native = mockNative();
    const playback = createIosAudioSessionPlayback(native);

    playback.stop();

    expect(native.deactivate).toHaveBeenCalledTimes(1);
    expect(native.activate).not.toHaveBeenCalled();
  });

  it('does not touch the session for setMuted/setVolume/setRoute (not this seam)', () => {
    const native = mockNative();
    const playback = createIosAudioSessionPlayback(native);

    playback.setMuted(true);
    playback.setVolume(0.5);
    playback.setRoute('speaker');

    expect(native.activate).not.toHaveBeenCalled();
    expect(native.deactivate).not.toHaveBeenCalled();
  });

  it('reports Bluetooth unavailable and offers only speaker + earpiece', () => {
    const playback = createIosAudioSessionPlayback(mockNative());
    expect(playback.isBluetoothAvailable()).toBe(false);
    expect(playback.getAvailableRoutes()).toEqual(['speaker', 'earpiece']);
  });

  it('swallows a rejected activate() so it never throws (AC2 resilience)', async () => {
    const native = mockNative({
      activate: jest.fn(() => Promise.reject(new Error('av failure'))),
    });
    const playback = createIosAudioSessionPlayback(native);

    expect(() => playback.start(fakeStream)).not.toThrow();
    // Let the guarded .catch run; the rejection must not surface.
    await flush();
    expect(native.activate).toHaveBeenCalledTimes(1);
  });

  it('swallows a synchronous throw from the native call', () => {
    const native = mockNative({
      deactivate: jest.fn(() => {
        throw new Error('sync boom');
      }),
    });
    const playback = createIosAudioSessionPlayback(native);

    expect(() => playback.stop()).not.toThrow();
  });
});

describe('createIosAudioSessionPlayback (native absent → safe no-op, AC2)', () => {
  it('every method is a no-op that never throws when the module is missing', () => {
    const playback = createIosAudioSessionPlayback(undefined);

    expect(() => {
      playback.start(fakeStream);
      playback.stop();
      playback.setMuted(true);
      playback.setVolume(1);
      for (const route of AUDIO_ROUTES) {
        playback.setRoute(route);
      }
    }).not.toThrow();
    expect(playback.isBluetoothAvailable()).toBe(false);
    expect(playback.getAvailableRoutes()).toEqual(['speaker', 'earpiece']);
  });
});

describe('createIosAudioPlayback (safe-wrapped, shipped factory)', () => {
  it('forwards start→activate / stop→deactivate through the safe wrapper', () => {
    const native = mockNative();
    const playback = createIosAudioPlayback(native);

    playback.start(fakeStream);
    playback.stop();

    expect(native.activate).toHaveBeenCalledTimes(1);
    expect(native.deactivate).toHaveBeenCalledTimes(1);
  });

  it('is a safe no-op when the native module is absent (Android / Jest)', () => {
    const playback = createIosAudioPlayback(undefined);
    expect(() => {
      playback.start(fakeStream);
      playback.stop();
    }).not.toThrow();
  });
});

describe('resolveAudioSessionModule', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
    delete (NativeModules as Record<string, unknown>).AudioSessionModule;
  });

  it('returns undefined on a non-iOS platform even if a module is registered', () => {
    Platform.OS = 'android';
    (NativeModules as Record<string, unknown>).AudioSessionModule = mockNative();

    expect(resolveAudioSessionModule()).toBeUndefined();
  });

  it('returns the module on iOS when activate/deactivate are present', () => {
    Platform.OS = 'ios';
    const native = mockNative();
    (NativeModules as Record<string, unknown>).AudioSessionModule = native;

    expect(resolveAudioSessionModule()).toBe(native);
  });

  it('returns undefined on iOS when the module is not registered', () => {
    Platform.OS = 'ios';
    delete (NativeModules as Record<string, unknown>).AudioSessionModule;

    expect(resolveAudioSessionModule()).toBeUndefined();
  });

  it('returns undefined when a registered object lacks the expected methods', () => {
    Platform.OS = 'ios';
    (NativeModules as Record<string, unknown>).AudioSessionModule = {
      activate: 'not a function',
    };

    expect(resolveAudioSessionModule()).toBeUndefined();
  });
});
