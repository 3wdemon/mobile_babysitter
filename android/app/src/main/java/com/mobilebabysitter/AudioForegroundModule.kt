package com.mobilebabysitter

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * AudioForegroundModule — the JS ⇄ native bridge for {@link AudioForegroundService}
 * (DMY-23). Exposed to React Native as `NativeModules.AudioForegroundModule`.
 *
 * Mirrors the iOS `AudioSessionModule` contract (DMY-48): two promise-returning
 * methods, `start` / `stop`, so the TS layer can `await` them and the JS safe
 * wrapper can swallow a rejection. The JS side ({@link androidAudioService}) only
 * calls these on Android and degrades to a no-op everywhere else, so the bridge
 * never needs platform guards itself.
 */
class AudioForegroundModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /**
   * Start the foreground audio service. Resolves once the start intent is
   * dispatched; rejects with a coded error the JS safe wrapper swallows if the
   * platform refuses (e.g. a background-start restriction). Idempotent on the
   * native side — re-asserting an already-running service just refreshes it.
   */
  @ReactMethod
  fun start(promise: Promise) {
    try {
      AudioForegroundService.start(reactContext)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject(ERROR_START, "Failed to start audio foreground service", error)
    }
  }

  /**
   * Stop the foreground audio service and dismiss its notification. Idempotent:
   * stopping a service that is not running is a safe no-op the platform tolerates.
   */
  @ReactMethod
  fun stop(promise: Promise) {
    try {
      AudioForegroundService.stop(reactContext)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject(ERROR_STOP, "Failed to stop audio foreground service", error)
    }
  }

  companion object {
    const val NAME = "AudioForegroundModule"
    private const val ERROR_START = "audio_foreground_start_failed"
    private const val ERROR_STOP = "audio_foreground_stop_failed"
  }
}
