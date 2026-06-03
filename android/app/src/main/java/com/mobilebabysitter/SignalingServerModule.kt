package com.mobilebabysitter

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * SignalingServerModule — the baby-unit's WebSocket SIGNALLING SERVER (DMY-72).
 *
 * ## Why a native module
 * React Native ships a WHATWG `WebSocket` *client* but NO server, so the
 * baby-unit (responder) cannot accept a parent's dial from JS. This is the
 * Android listen side, built on `org.java-websocket` (a small, mature, pure-JVM
 * WS server). The matching iOS side is `SignalingServer.swift` (NWListener +
 * hand-rolled RFC 6455 framing); both expose the SAME JS surface
 * (`NativeModules.SignalingServer`) so the TS wrapper is platform-agnostic.
 *
 * ## Why plain `ws` (no TLS)
 * Local-network only, and the media is DTLS-SRTP encrypted by WebRTC regardless,
 * so a self-signed cert on the SIGNALLING channel would add friction for no gain
 * (DMY-72 default).
 *
 * ## Auth
 * The parent dials `ws://host:port/?secret=<sessionId>` (the ephemeral pairing id
 * from the QR, DMY-6). The upgrade is REJECTED (the socket is closed immediately)
 * unless the `secret` query matches the `sessionId` passed to [start]. The secret
 * is compared in constant time and NEVER logged.
 *
 * ## Port
 * Probes `port .. port+10` (DMY-72 default 8443→8453) and binds the first free
 * one, resolving [start] with the actual bound port.
 *
 * ## Events (mirror src/native/signalingServer.ts)
 *  - SignalingServerConnection { clientId } — AFTER the secret check passes
 *  - SignalingServerMessage    { clientId, data }
 *  - SignalingServerClose      { clientId }
 *  - SignalingServerError      { message } — coarse, non-PII; never the secret
 *
 * No media or PII is logged here.
 */
class SignalingServerModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  private var server: SignalingWsServer? = null

  /** Opaque clientId → live WebSocket, for routed [send] / [closeClient]. */
  private val clients = ConcurrentHashMap<String, WebSocket>()

  /**
   * Bind + listen, probing [PORT_RANGE] candidates from the requested port.
   * Resolves with the ACTUAL bound port; rejects if no port is free.
   *
   * `org.java-websocket`'s [WebSocketServer.start] is ASYNCHRONOUS: it only spawns
   * the accept thread and returns immediately, so the real socket bind happens
   * later on that thread. A busy port therefore surfaces as a late
   * `onError` with a `BindException` (conn == null) — it is NEVER
   * thrown out of [WebSocketServer.start]. We must wait for the async outcome of
   * EACH candidate before deciding to resolve or to try the next port, mirroring
   * the iOS NWListener.stateUpdateHandler (.ready ⇒ resolve, .failed ⇒ next port).
   *
   * Done off the bridge thread (a background [Thread]) because we block on a latch.
   */
  @ReactMethod
  fun start(params: ReadableMap, promise: Promise) {
    val preferredPort = if (params.hasKey("port")) params.getInt("port") else DEFAULT_PORT
    val secret = if (params.hasKey("sessionId")) params.getString("sessionId") ?: "" else ""
    Thread {
      // A re-start replaces any prior listener.
      stopServerQuietly()
      bindFirstFreePort(preferredPort, secret, promise)
    }.apply { name = "signaling-bind"; isDaemon = true }.start()
  }

  /**
   * Probe `from .. from+PORT_RANGE` for a free port, AWAITING each candidate's
   * async bind outcome (onStart ⇒ bound, BindException via onError ⇒ busy) before
   * moving on. Resolves with the bound port, or rejects if the whole range is busy.
   */
  private fun bindFirstFreePort(from: Int, secret: String, promise: Promise) {
    var lastError: Exception? = null
    for (candidate in from until from + PORT_RANGE) {
      val latch = CountDownLatch(1)
      // Set by the server callbacks BEFORE counting the latch down.
      var bound = false
      var bindError: Exception? = null

      val ws = SignalingWsServer(
        address = InetSocketAddress(candidate),
        secret = secret,
        onBound = {
          bound = true
          latch.countDown()
        },
        onBindFailed = { ex ->
          bindError = ex
          latch.countDown()
        },
      )
      // Allow rebinding a port still in TIME_WAIT from a prior session.
      ws.isReuseAddr = true
      ws.start()

      // Wait for the async bind to either succeed (onStart) or fail (onError).
      val signalled = latch.await(BIND_TIMEOUT_SECONDS, TimeUnit.SECONDS)

      if (signalled && bound) {
        server = ws
        promise.resolve(candidate)
        return
      }

      // Busy port, bind error, or timeout: stop this server cleanly (no thread or
      // socket leak) before advancing to the next candidate.
      lastError = bindError ?: lastError
      stopQuietly(ws)
    }
    promise.reject(
      ERROR_BIND,
      "No free port in range for the signalling server",
      lastError,
    )
  }

  /** Frame a JSON string to ONE accepted parent (best-effort). */
  @ReactMethod
  fun send(clientId: String, message: String) {
    val conn = clients[clientId] ?: return
    try {
      if (conn.isOpen) conn.send(message)
    } catch (_: Exception) {
      // Best-effort: a write to a gone client must never crash signalling.
    }
  }

  /** Close ONE parent's socket. */
  @ReactMethod
  fun closeClient(clientId: String) {
    val conn = clients.remove(clientId) ?: return
    try {
      conn.close()
    } catch (_: Exception) {
      // ignore — best-effort.
    }
  }

  /** Tear the whole listener + all sockets down (idempotent). */
  @ReactMethod
  fun stop(promise: Promise) {
    stopServerQuietly()
    promise.resolve(null)
  }

  /** RN requires these on a module backing a NativeEventEmitter. No-ops here. */
  @ReactMethod
  fun addListener(eventName: String) {
    // Keep: RN warns without it. The DeviceEventManagerModule does the routing.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Keep: RN warns without it.
  }

  private fun stopServerQuietly() {
    val current = server
    server = null
    clients.clear()
    if (current != null) stopQuietly(current)
  }

  /** Best-effort stop of ONE server instance (blocks briefly so no thread leaks). */
  private fun stopQuietly(ws: SignalingWsServer) {
    try {
      // A short timeout so a blocked socket cannot hang teardown.
      ws.stop(STOP_TIMEOUT_MS)
    } catch (_: Exception) {
      // ignore — best-effort teardown.
    }
  }

  private fun emit(eventName: String, payload: WritableMap) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, payload)
  }

  /**
   * The org.java-websocket server. Validates the shared secret on the upgrade
   * (via the request resource `?secret=`); a mismatch closes the socket BEFORE a
   * connection event is emitted.
   *
   * [onBound] fires once from [onStart] AFTER a successful async bind; [onBindFailed]
   * fires once if the very first signal is a bind-time error (e.g. the port is in
   * use). [bindSettled] guarantees the [start] loop is signalled at most once, so a
   * later runtime [onError] is reported only as an event, never as a bind verdict.
   */
  private inner class SignalingWsServer(
    address: InetSocketAddress,
    private val secret: String,
    private val onBound: () -> Unit,
    private val onBindFailed: (Exception) -> Unit,
  ) : WebSocketServer(address) {

    /** True once we've reported the bind outcome (bound or failed) to [start]. */
    @Volatile private var bindSettled = false

    override fun onStart() {
      // Reached only AFTER a successful async bind — this is the "ready" signal.
      if (!bindSettled) {
        bindSettled = true
        onBound()
      }
    }

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
      val provided = querySecret(handshake.resourceDescriptor)
      if (!constantTimeEquals(provided, secret)) {
        // Reject unauthenticated dials. Never log the secret.
        conn.close()
        return
      }
      val clientId = UUID.randomUUID().toString()
      conn.setAttachment(clientId)
      clients[clientId] = conn
      emit(EVENT_CONNECTION, Arguments.createMap().apply { putString("clientId", clientId) })
    }

    override fun onMessage(conn: WebSocket, message: String) {
      val clientId = conn.getAttachment<String>() ?: return
      emit(
        EVENT_MESSAGE,
        Arguments.createMap().apply {
          putString("clientId", clientId)
          putString("data", message)
        },
      )
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
      val clientId = conn.getAttachment<String>() ?: return
      if (clients.remove(clientId) != null) {
        emit(EVENT_CLOSE, Arguments.createMap().apply { putString("clientId", clientId) })
      }
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
      // A server-level error (conn == null) that arrives BEFORE onStart is the
      // async bind failing — most commonly a BindException for a busy port. Hand
      // it to [start] so the loop can advance to the next candidate port.
      if (conn == null && !bindSettled) {
        bindSettled = true
        onBindFailed(ex)
        return
      }
      // Otherwise it's a per-connection or post-bind runtime error: coarse,
      // non-PII description only.
      emit(
        EVENT_ERROR,
        Arguments.createMap().apply {
          putString("message", ex.message ?: "signalling server error")
        },
      )
    }
  }

  companion object {
    const val NAME = "SignalingServer"
    private const val DEFAULT_PORT = 8443
    private const val PORT_RANGE = 11
    private const val STOP_TIMEOUT_MS = 500

    /**
     * Max wait for ONE candidate's async bind to settle (onStart or a bind
     * onError). A miss is treated as a failed bind and the loop tries the next
     * port; a local socket bind resolves in milliseconds, so this is generous.
     */
    private const val BIND_TIMEOUT_SECONDS = 3L
    private const val ERROR_BIND = "signaling_bind_failed"

    private const val EVENT_CONNECTION = "SignalingServerConnection"
    private const val EVENT_MESSAGE = "SignalingServerMessage"
    private const val EVENT_CLOSE = "SignalingServerClose"
    private const val EVENT_ERROR = "SignalingServerError"

    /** Parse `?secret=<value>` from the WS request resource descriptor. */
    private fun querySecret(resource: String?): String {
      if (resource == null) return ""
      val qIndex = resource.indexOf('?')
      if (qIndex < 0) return ""
      val query = resource.substring(qIndex + 1)
      for (pair in query.split('&')) {
        val kv = pair.split('=', limit = 2)
        if (kv.size == 2 && kv[0] == "secret") {
          return try {
            java.net.URLDecoder.decode(kv[1], "UTF-8")
          } catch (_: Exception) {
            kv[1]
          }
        }
      }
      return ""
    }

    /** Constant-time comparison so the auth check does not leak via timing. */
    private fun constantTimeEquals(a: String, b: String): Boolean {
      val ab = a.toByteArray(Charsets.UTF_8)
      val bb = b.toByteArray(Charsets.UTF_8)
      if (ab.size != bb.size) return false
      var diff = 0
      for (i in ab.indices) diff = diff or (ab[i].toInt() xor bb[i].toInt())
      return diff == 0
    }
  }
}
