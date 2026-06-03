/**
 * Unit tests for the Android background-audio foreground-service controller
 * (DMY-23).
 *
 * The AC ("audio not interrupted in the background; foreground-service visible
 * in the notification") is behavioral and unachievable under Jest. Here we cover
 * the CONTRACT: start() calls the native start; stop() calls the native stop; an
 * ABSENT native module (iOS / Jest) degrades to a safe no-op that never throws;
 * and a present-but-flaky module (sync throw OR rejected promise) is swallowed.
 * The native Kotlin service is asserted by the manual device check in the PR.
 */
import { NativeModules, Platform } from 'react-native';

import {
  type AndroidAudioForegroundNativeModule,
  createAndroidAudioService,
  noopAndroidAudioService,
  resolveAndroidAudioModule,
} from '../androidAudioService';

/** A native-module test double whose start/stop are jest mocks. */
function mockNative(
  overrides: Partial<AndroidAudioForegroundNativeModule> = {},
): AndroidAudioForegroundNativeModule {
  return {
    start: jest.fn(() => Promise.resolve()),
    stop: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

/** Flush pending microtasks so a guarded promise's .catch can run. */
const flush = () => Promise.resolve();

describe('createAndroidAudioService (native present)', () => {
  it('start() promotes to the foreground service (AC contract)', () => {
    const native = mockNative();
    const service = createAndroidAudioService(native);

    service.start();

    expect(native.start).toHaveBeenCalledTimes(1);
    expect(native.stop).not.toHaveBeenCalled();
  });

  it('stop() tears the foreground service down', () => {
    const native = mockNative();
    const service = createAndroidAudioService(native);

    service.stop();

    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(native.start).not.toHaveBeenCalled();
  });

  it('swallows a rejected start() so it never throws (resilience)', async () => {
    const native = mockNative({
      start: jest.fn(() => Promise.reject(new Error('start failure'))),
    });
    const service = createAndroidAudioService(native);

    expect(() => service.start()).not.toThrow();
    // Let the guarded .catch run; the rejection must not surface.
    await flush();
    expect(native.start).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected stop() so it never throws', async () => {
    const native = mockNative({
      stop: jest.fn(() => Promise.reject(new Error('stop failure'))),
    });
    const service = createAndroidAudioService(native);

    expect(() => service.stop()).not.toThrow();
    await flush();
    expect(native.stop).toHaveBeenCalledTimes(1);
  });

  it('swallows a synchronous throw from the native start', () => {
    const native = mockNative({
      start: jest.fn(() => {
        throw new Error('sync boom');
      }),
    });
    const service = createAndroidAudioService(native);

    expect(() => service.start()).not.toThrow();
  });

  it('swallows a synchronous throw from the native stop', () => {
    const native = mockNative({
      stop: jest.fn(() => {
        throw new Error('sync boom');
      }),
    });
    const service = createAndroidAudioService(native);

    expect(() => service.stop()).not.toThrow();
  });
});

describe('createAndroidAudioService (native absent → safe no-op)', () => {
  it('start/stop are no-ops that never throw when the module is missing', () => {
    const service = createAndroidAudioService(undefined);

    expect(() => {
      service.start();
      service.stop();
    }).not.toThrow();
  });

  it('returns the shared no-op shape when the module is missing', () => {
    const service = createAndroidAudioService(undefined);
    expect(service).toBe(noopAndroidAudioService);
  });
});

describe('noopAndroidAudioService', () => {
  it('start/stop are no-ops that never throw', () => {
    expect(() => {
      noopAndroidAudioService.start();
      noopAndroidAudioService.stop();
    }).not.toThrow();
  });
});

describe('resolveAndroidAudioModule', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
    delete (NativeModules as Record<string, unknown>).AudioForegroundModule;
  });

  it('returns undefined on a non-Android platform even if a module is registered', () => {
    Platform.OS = 'ios';
    (NativeModules as Record<string, unknown>).AudioForegroundModule =
      mockNative();

    expect(resolveAndroidAudioModule()).toBeUndefined();
  });

  it('returns the module on Android when start/stop are present', () => {
    Platform.OS = 'android';
    const native = mockNative();
    (NativeModules as Record<string, unknown>).AudioForegroundModule = native;

    expect(resolveAndroidAudioModule()).toBe(native);
  });

  it('returns undefined on Android when the module is not registered', () => {
    Platform.OS = 'android';
    delete (NativeModules as Record<string, unknown>).AudioForegroundModule;

    expect(resolveAndroidAudioModule()).toBeUndefined();
  });

  it('returns undefined when a registered object lacks the expected methods', () => {
    Platform.OS = 'android';
    (NativeModules as Record<string, unknown>).AudioForegroundModule = {
      start: 'not a function',
    };

    expect(resolveAndroidAudioModule()).toBeUndefined();
  });

  it('returns undefined when only one of start/stop is present', () => {
    Platform.OS = 'android';
    (NativeModules as Record<string, unknown>).AudioForegroundModule = {
      start: jest.fn(),
    };

    expect(resolveAndroidAudioModule()).toBeUndefined();
  });
});

describe('createAndroidAudioService (default resolution)', () => {
  it('falls back to the no-op when no module is resolvable (Jest default OS)', () => {
    // Under Jest Platform.OS is 'ios' by default and no AudioForegroundModule is
    // registered, so the default-argument resolution yields the no-op.
    const service = createAndroidAudioService();
    expect(() => {
      service.start();
      service.stop();
    }).not.toThrow();
  });
});
