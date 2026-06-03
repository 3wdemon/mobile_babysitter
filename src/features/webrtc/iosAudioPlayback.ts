/**
 * iosAudioPlayback — iOS background-audio {@link AudioPlayback} backed by a plain
 * `AVAudioSession`, NO CallKit / PushKit (DMY-48).
 *
 * ## Why this exists (the $0 alternative to DMY-22)
 * Keeping a call alive in the background the "Apple way" (CallKit + a PushKit
 * VoIP push) needs a PAID Apple Developer account and the VoIP background-mode
 * entitlement. For the MVP we instead configure a `.playAndRecord` /
 * `.voiceChat` {@link AVAudioSession} and declare `UIBackgroundModes: ['audio']`
 * in Info.plist — which keeps remote audio playing while the parent device's
 * screen is locked WITHOUT any paid entitlement (AC1). The native side is
 * {@link AudioSessionModule} (Swift + an Obj-C `RCT_EXTERN_MODULE` bridge).
 *
 * ## Design boundary (HONEST — mirrors audioPlayback.ts)
 * react-native-webrtc already renders a live remote audio track to the default
 * output on its own. This controller's ONLY job is to hold an active audio
 * session so that playback survives backgrounding. So:
 *  - {@link AudioPlayback.start} activates the session.
 *  - {@link AudioPlayback.stop} deactivates it (releases audio focus / mic
 *    indicator on teardown, AC3).
 *  - `setMuted` / `setVolume` / `setRoute` stay no-ops here — output muting,
 *    volume and concrete route (DMY-55/56) are NOT this seam's concern; the
 *    track plays on the default output and the store holds the preferences.
 *
 * ## Safe degradation (AC2)
 * The native module is iOS-only and absent under Jest / on Android. We lazily
 * resolve it from {@link NativeModules}; when it is missing every method is a
 * silent no-op and NOTHING throws. Always wrap the result with
 * {@link createSafeAudioPlayback} (as the other backends do) so even a present-
 * but-flaky native module can never crash a monitoring session — the native
 * calls are promise-returning and a rejection is swallowed by the safe wrapper's
 * `safeAsync`. We additionally guard the promise locally so an un-awaited
 * rejection never surfaces as an unhandled-rejection warning.
 *
 * ## Privacy
 * No media content is touched or logged — only coarse, non-PII lifecycle facts.
 */
import { NativeModules, Platform } from 'react-native';

import { logger } from '../../services/logger';
import {
  type AudioPlayback,
  type AudioRoute,
  availableRoutesFor,
  createSafeAudioPlayback,
  noopAudioPlayback,
} from './audioPlayback';

/**
 * The slice of the native {@link AudioSessionModule} we call. Both methods are
 * promise-returning (the Swift side resolves/rejects an `RCTPromise`). Kept
 * structural so the TS layer is fully unit-testable against a tiny mock with no
 * native dependency.
 */
export interface AudioSessionNativeModule {
  /** Configure + activate the `.playAndRecord`/`.voiceChat` session. */
  activate(): Promise<void>;
  /** Deactivate the session, releasing audio focus. */
  deactivate(): Promise<void>;
}

/**
 * Lazily resolve the native module, returning `undefined` when it is absent
 * (Jest, Android, or an iOS build where the module is not linked). Resolved
 * fresh on each call rather than cached so a test can swap `NativeModules`
 * between cases; resolution is a cheap property read.
 */
export function resolveAudioSessionModule(): AudioSessionNativeModule | undefined {
  // Only iOS ships this bridge. On other platforms there is nothing to find, so
  // skip the lookup entirely and degrade to the no-op.
  if (Platform.OS !== 'ios') {
    return undefined;
  }
  const native = (NativeModules as Record<string, unknown>).AudioSessionModule;
  if (
    native &&
    typeof (native as AudioSessionNativeModule).activate === 'function' &&
    typeof (native as AudioSessionNativeModule).deactivate === 'function'
  ) {
    return native as AudioSessionNativeModule;
  }
  return undefined;
}

/**
 * Run a native promise-returning call and locally swallow any rejection (and any
 * synchronous throw) so an un-awaited native failure never becomes an unhandled
 * rejection. Logs a coarse, non-PII lifecycle warning only. The outer
 * {@link createSafeAudioPlayback} wrapper provides a second layer of the same
 * guarantee.
 */
function guard(op: string, fn: () => Promise<void>): void {
  try {
    fn().catch(() => {
      logger.warn('webrtc/audio: iOS audio-session call failed', { op });
    });
  } catch {
    logger.warn('webrtc/audio: iOS audio-session call failed', { op });
  }
}

/**
 * Build the raw (unwrapped) iOS audio-session {@link AudioPlayback}. When the
 * native module is absent this is exactly {@link noopAudioPlayback}, so callers
 * on Android / under Jest get a safe no-op (AC2). Prefer {@link createIosAudioPlayback},
 * which additionally wraps this in {@link createSafeAudioPlayback}.
 *
 * @param nativeModule Inject a fake in tests; defaults to the lazily-resolved
 *   native module.
 */
export function createIosAudioSessionPlayback(
  nativeModule: AudioSessionNativeModule | undefined = resolveAudioSessionModule(),
): AudioPlayback {
  if (!nativeModule) {
    // No native session available — degrade to the shared safe no-op so the seam
    // behaves identically to "no controller wired" (AC2).
    return noopAudioPlayback;
  }

  return {
    // Activating the .playAndRecord/.voiceChat session is what keeps remote audio
    // playing with the screen locked (AC1). The remote track is already attached
    // by react-native-webrtc; we only hold the session alive.
    start: () => {
      guard('activate', () => nativeModule.activate());
    },
    // Release the session on teardown so iOS reclaims audio focus and the mic
    // indicator clears (AC3).
    stop: () => {
      guard('deactivate', () => nativeModule.deactivate());
    },
    // Output muting / volume / concrete route are not this seam's concern — the
    // remote track plays on the default output and DMY-55/56 hold the prefs.
    setMuted: () => {},
    setVolume: () => {},
    setRoute: () => {},
    // Bluetooth availability is read by the routing layer (DMY-55), not here; the
    // background-session controller reports it unavailable like the no-op does.
    isBluetoothAvailable: () => false,
    getAvailableRoutes: (): readonly AudioRoute[] => availableRoutesFor(false),
  };
}

/**
 * The shipped iOS audio-session {@link AudioPlayback}, wrapped with
 * {@link createSafeAudioPlayback} so no call ever throws and every lifecycle
 * transition is logged at a coarse, non-PII level. On Android / under Jest the
 * underlying backend is the no-op, so this is a safe no-op too (AC2).
 */
export function createIosAudioPlayback(
  nativeModule: AudioSessionNativeModule | undefined = resolveAudioSessionModule(),
): AudioPlayback {
  return createSafeAudioPlayback(createIosAudioSessionPlayback(nativeModule));
}
