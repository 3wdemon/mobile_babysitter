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
   */
  @ReactMethod
  fun start(params: ReadableMap, promise: Promise) {
    val preferredPort = if (params.hasKey("port")) params.getInt("port") else DEFAULT_PORT
    val secret = if (params.hasKey("sessionId")) params.getString("sessionId") ?: "" else ""
    // A re-start replaces any prior listener.
    stopServerQuietly()

    var lastError: Exception? = null
    for (candidate in preferredPort until preferredPort + PORT_RANGE) {
      try {
        val ws = SignalingWsServer(InetSocketAddress(candidate), secret)
        // Fail fast if the port is taken rather than after the async start.
        ws.isReuseAddr = true
        ws.start()
        server = ws
        promise.resolve(candidate)
        return
      } catch (error: Exception) {
        lastError = error
        // Try the next candidate port.
      }
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
    if (current != null) {
      try {
        // A short timeout so a blocked socket cannot hang teardown.
        current.stop(STOP_TIMEOUT_MS)
      } catch (_: Exception) {
        // ignore — best-effort teardown.
      }
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
   */
  private inner class SignalingWsServer(
    address: InetSocketAddress,
    private val secret: String,
  ) : WebSocketServer(address) {

    override fun onStart() {
      // Bound + accepting. Nothing to do; [start]'s resolve already fired.
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
      // Coarse, non-PII description only.
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
