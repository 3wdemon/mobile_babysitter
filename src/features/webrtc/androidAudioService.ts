/**
 * androidAudioService — Android background-audio lifecycle controller backed by
 * a plain Foreground Service, NO ConnectionService (DMY-23).
 *
 * ## Why this exists (the Android mirror of DMY-48)
 * On Android the OS will freeze/throttle a backgrounded process, cutting the
 * parent-unit's monitor audio when the screen locks. The robust, system-blessed
 * fix is a STARTED Foreground Service with a persistent notification — and on
 * Android 14+ the service declares the `microphone | mediaPlayback`
 * `foregroundServiceType`s. The DMY-23 issue title floated `ConnectionService`,
 * but that is the heavyweight telecom/dialer-integration API and is overkill for
 * a P2P monitor; we mirror the iOS DMY-48 decision (plain AVAudioSession instead
 * of CallKit) and use an ordinary foreground service. Native side:
 * {@link AudioForegroundService} (Kotlin) + {@link AudioForegroundModule} bridge.
 *
 * ## Contract (mirrors {@link AudioSessionNativeModule} on iOS)
 * Two promise-returning methods, `start` / `stop`. This is a SEPARATE seam from
 * {@link AudioPlayback}: AudioPlayback routes the remote track (speaker / volume
 * / mute), whereas this controller only holds the OS foreground session alive so
 * that routing keeps working in the background. Keeping them separate means the
 * iOS AVAudioSession seam and this Android foreground-service seam stay small and
 * independently testable.
 *
 * ## Safe degradation (no-op fallback)
 * The native module is Android-only and absent under Jest / on iOS. We lazily
 * resolve it from {@link NativeModules}; when it is missing both methods are
 * silent no-ops and NOTHING throws. We additionally guard each native call so a
 * synchronous throw OR a rejected promise from a present-but-flaky module is
 * swallowed (a foreground-service failure must never crash a monitoring
 * session). Only coarse, non-PII lifecycle facts are logged.
 */
import { NativeModules, Platform } from 'react-native';

import { logger } from '../../services/logger';

/**
 * The slice of the native {@link AudioForegroundModule} we call. Both methods are
 * promise-returning (the Kotlin side resolves/rejects a `Promise`). Kept
 * structural so the TS layer is fully unit-testable against a tiny mock with no
 * native dependency.
 */
export interface AndroidAudioForegroundNativeModule {
  /** Start the foreground service (persistent notification + audio types). */
  start(): Promise<void>;
  /** Stop the foreground service, dismissing its notification. */
  stop(): Promise<void>;
}

/**
 * A minimal lifecycle controller for the Android background-audio foreground
 * service. Distinct from {@link AudioPlayback}: this only governs the OS session.
 */
export interface AndroidAudioService {
  /** Promote the app to a foreground audio service (background-safe playback). */
  start(): void;
  /** Tear the foreground service down on session teardown / unmount. */
  stop(): void;
}

/** Shared no-op used on iOS / under Jest / when the native module is absent. */
export const noopAndroidAudioService: AndroidAudioService = {
  start: () => {},
  stop: () => {},
};

/**
 * Lazily resolve the native module, returning `undefined` when it is absent
 * (Jest, iOS, or an Android build where the module is not linked). Resolved
 * fresh on each call rather than cached so a test can swap `NativeModules`
 * between cases; resolution is a cheap property read.
 */
export function resolveAndroidAudioModule():
  | AndroidAudioForegroundNativeModule
  | undefined {
  // Only Android ships this bridge. On other platforms there is nothing to find.
  if (Platform.OS !== 'android') {
    return undefined;
  }
  const native = (NativeModules as Record<string, unknown>)
    .AudioForegroundModule;
  if (
    native &&
    typeof (native as AndroidAudioForegroundNativeModule).start ===
      'function' &&
    typeof (native as AndroidAudioForegroundNativeModule).stop === 'function'
  ) {
    return native as AndroidAudioForegroundNativeModule;
  }
  return undefined;
}

/**
 * Run a native promise-returning call and locally swallow any rejection (and any
 * synchronous throw) so a native failure never becomes an unhandled rejection or
 * crashes the caller. Logs a coarse, non-PII lifecycle warning only.
 */
function guard(op: string, fn: () => Promise<void>): void {
  try {
    fn().catch(() => {
      logger.warn('webrtc/audio: Android foreground-service call failed', {
        op,
      });
    });
  } catch {
    logger.warn('webrtc/audio: Android foreground-service call failed', { op });
  }
}

/**
 * Build the Android background-audio {@link AndroidAudioService}. When the native
 * module is absent (iOS / Jest / unlinked) this is exactly
 * {@link noopAndroidAudioService}, so non-Android callers get a safe no-op.
 *
 * @param nativeModule Inject a fake in tests; defaults to the lazily-resolved
 *   native module.
 */
export function createAndroidAudioService(
  nativeModule:
    | AndroidAudioForegroundNativeModule
    | undefined = resolveAndroidAudioModule(),
): AndroidAudioService {
  if (!nativeModule) {
    return noopAndroidAudioService;
  }

  return {
    // Promote to a foreground service so the OS keeps the process alive and
    // remote audio keeps playing with the screen locked (AC).
    start: () => {
      guard('start', () => nativeModule.start());
      logger.info('webrtc/audio: Android foreground audio service started');
    },
    // Tear down the foreground service on teardown/unmount so the notification
    // clears and the OS reclaims the foreground slot.
    stop: () => {
      guard('stop', () => nativeModule.stop());
      logger.info('webrtc/audio: Android foreground audio service stopped');
    },
  };
}
