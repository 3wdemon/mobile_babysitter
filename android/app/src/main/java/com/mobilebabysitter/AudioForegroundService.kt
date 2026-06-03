package com.mobilebabysitter

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * AudioForegroundService — keeps the parent-unit's remote monitor audio alive
 * while the app is backgrounded / the screen is locked (DMY-23).
 *
 * ## Why a plain Foreground Service (NOT ConnectionService)
 * The DMY-23 issue title floated `ConnectionService`, but that is the telecom
 * integration API: it wires an app into the system phone/call stack (in-call UI,
 * audio focus arbitration with cellular calls, self-managed call accounts). For
 * a P2P baby monitor that is heavy, brittle and unnecessary — we never integrate
 * with the dialer. So we MIRROR the iOS decision in DMY-48 (which dropped CallKit
 * for a plain AVAudioSession): use an ordinary started Foreground Service that
 * shows a persistent notification and declares the `microphone | mediaPlayback`
 * foreground-service types. That alone tells Android "this process is doing
 * ongoing audio work, don't freeze it", which is exactly the AC: audio does not
 * cut out in the background and a notification is visible. ConnectionService can
 * be revisited in v2 (a separate issue) if real telecom integration is ever
 * wanted.
 *
 * ## foregroundServiceType (Android 14 / API 34+)
 * Android 14 requires every foreground service to declare a type both in the
 * manifest and at `startForeground` time. We declare BOTH:
 *  - `microphone`    — the two-way-talk path captures the parent mic (DMY-20).
 *  - `mediaPlayback` — the remote baby audio is played back continuously.
 * Declaring both keeps the duplex monitor session legal regardless of which
 * direction is momentarily active.
 *
 * ## Privacy
 * The notification text is a fixed, non-PII string. No media content, peer
 * identity or session id is ever placed in the notification or logged here.
 */
class AudioForegroundService : Service() {

  /**
   * A started (not bound) service: React Native drives lifecycle through
   * `startService` / `stopService`, so binding is unused.
   */
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    promoteToForeground()
    // START_STICKY: if the OS kills the process under memory pressure it will
    // recreate the service (with a null intent) and re-assert the foreground
    // notification, so a backgrounded monitor self-heals rather than going dark.
    return START_STICKY
  }

  /**
   * Build the persistent notification + channel and enter the foreground with the
   * `microphone | mediaPlayback` types on Android 14+. On older APIs the typed
   * overload is unavailable, so we fall back to the untyped `startForeground`.
   */
  private fun promoteToForeground() {
    ensureChannel()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  /**
   * Create the low-importance notification channel once (no-op on a re-create or
   * pre-O). Low importance keeps the persistent monitor notification silent and
   * non-intrusive while still satisfying the "service is visible" requirement.
   */
  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) {
      return
    }
    val channel =
      NotificationChannel(
        CHANNEL_ID,
        CHANNEL_NAME,
        NotificationManager.IMPORTANCE_LOW,
      )
    channel.description = CHANNEL_DESCRIPTION
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  /**
   * Build the ongoing notification. Uses the platform Notification.Builder with
   * the channel on O+ and the deprecated builder on older APIs (minSdk 26 means
   * O+ is the common path, but the fallback keeps the file self-contained).
   */
  @Suppress("DEPRECATION")
  private fun buildNotification(): Notification {
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL_ID)
      } else {
        Notification.Builder(this)
      }
    return builder
      .setContentTitle(NOTIFICATION_TITLE)
      .setContentText(NOTIFICATION_TEXT)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .build()
  }

  companion object {
    /** JS-visible action names routed through the native module. */
    const val ACTION_START = "com.mobilebabysitter.audio.START"
    const val ACTION_STOP = "com.mobilebabysitter.audio.STOP"

    private const val CHANNEL_ID = "mobile_babysitter_audio"
    private const val CHANNEL_NAME = "Baby monitor audio"
    private const val CHANNEL_DESCRIPTION =
      "Keeps baby-monitor audio playing while the app is in the background."
    private const val NOTIFICATION_ID = 4823
    private const val NOTIFICATION_TITLE = "Baby monitor active"
    private const val NOTIFICATION_TEXT = "Listening to your baby in the background."

    /** Start the foreground service (idempotent — re-asserts the notification). */
    fun start(context: Context) {
      val intent = Intent(context, AudioForegroundService::class.java)
      intent.action = ACTION_START
      // startForegroundService is required on O+ so the OS expects the upcoming
      // startForeground call within its grace window.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    /** Stop the foreground service and dismiss its notification (idempotent). */
    fun stop(context: Context) {
      val intent = Intent(context, AudioForegroundService::class.java)
      intent.action = ACTION_STOP
      context.stopService(intent)
    }
  }
}
