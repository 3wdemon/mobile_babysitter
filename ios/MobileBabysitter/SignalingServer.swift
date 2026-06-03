import Foundation
import Network
import React
import CryptoKit

/// SignalingServer — the baby-unit's WebSocket SIGNALLING SERVER (DMY-72).
///
/// ## Why a native module
/// React Native ships a WHATWG `WebSocket` *client* but NO server, so the
/// baby-unit (responder) cannot accept a parent's dial from JS. This module is
/// the iOS listen side: a `Network.framework` `NWListener` over plain TCP with a
/// minimal RFC 6455 WebSocket upgrade + text-frame codec implemented by hand.
/// The matching Android side is `SignalingServerModule.kt` (org.java-websocket);
/// both expose the SAME JS surface (`SignalingServer` native module) so the TS
/// wrapper (`src/native/signalingServer.ts`) is platform-agnostic.
///
/// ## Why plain `ws` (no TLS)
/// The link is LOCAL-network only and the media itself is DTLS-SRTP encrypted by
/// WebRTC regardless, so a self-signed `wss` cert on a `.local` host would only
/// add friction for zero security gain on the SIGNALLING channel. (Decision per
/// DMY-72 defaults.)
///
/// ## Why NWListener + hand-rolled framing (not URLSessionWebSocketTask)
/// `URLSessionWebSocketTask` is a WebSocket *client* API; there is no
/// first-party server type on iOS. `NWListener` gives us the accepted TCP
/// connections; the WS handshake (Sec-WebSocket-Key → Accept) and text-frame
/// encode/decode are small and well-specified, so we implement just the subset
/// the signalling JSON needs (text frames, close, ping/pong) — adequate for the
/// MVP. Binary frames and fragmentation beyond a single continuation are not
/// required by the JSON signalling protocol.
///
/// ## Auth
/// The parent dials `ws://host:port/?secret=<sessionId>` (the ephemeral pairing
/// id from the QR, DMY-6). The upgrade is REJECTED (101 withheld, socket closed)
/// unless the query `secret` matches the `sessionId` passed to `start`. The
/// secret is compared in constant time and NEVER logged.
///
/// ## Port
/// Probes `port ... port+10` (DMY-72 default 8443→8453) and binds the first free
/// one, resolving `start` with the actual bound port.
///
/// ## Concurrency
/// All mutable state (the listener, the connections map) is confined to a serial
/// queue; React emits events on its own queue. No media or PII is ever logged.
@objc(SignalingServer)
final class SignalingServer: RCTEventEmitter {

  // MARK: - Event names (mirror src/native/signalingServer.ts)
  private static let evConnection = "SignalingServerConnection"
  private static let evMessage = "SignalingServerMessage"
  private static let evClose = "SignalingServerClose"
  private static let evError = "SignalingServerError"

  /// RFC 6455 fixed GUID used to derive the `Sec-WebSocket-Accept` value.
  private static let wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

  /// Serial queue confining all listener/connection mutation.
  private let queue = DispatchQueue(label: "com.mobilebabysitter.signaling")

  private var listener: NWListener?
  /// Accepted, UPGRADED client connections keyed by an opaque client id.
  private var clients: [String: NWConnection] = [:]
  /// The shared secret to validate on the upgrade (the pairing sessionId).
  private var sharedSecret: String = ""
  /// Whether JS currently has listeners attached (gate event emission).
  private var hasListeners = false

  // MARK: - RCTEventEmitter

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String] {
    return [
      SignalingServer.evConnection,
      SignalingServer.evMessage,
      SignalingServer.evClose,
      SignalingServer.evError,
    ]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  private func emit(_ name: String, _ body: [String: Any]) {
    guard hasListeners else { return }
    sendEvent(withName: name, body: body)
  }

  // MARK: - JS API

  /// Bind + listen, probing `port..port+10`. Resolves with the actual bound port.
  @objc(start:resolver:rejecter:)
  func start(
    _ params: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let preferredPort = (params["port"] as? NSNumber)?.intValue ?? 8443
    let secret = (params["sessionId"] as? String) ?? ""
    queue.async { [weak self] in
      guard let self = self else { return }
      self.sharedSecret = secret
      self.tearDownLocked()
      self.tryBind(from: preferredPort, attemptsLeft: 11, resolve: resolve, reject: reject)
    }
  }

  /// Frame a JSON string to ONE accepted parent (best-effort).
  @objc(send:message:)
  func send(_ clientId: String, message: String) {
    queue.async { [weak self] in
      guard let self = self, let conn = self.clients[clientId] else { return }
      self.sendText(message, over: conn)
    }
  }

  /// Close ONE parent's socket.
  @objc(closeClient:)
  func closeClient(_ clientId: String) {
    queue.async { [weak self] in
      guard let self = self, let conn = self.clients.removeValue(forKey: clientId) else { return }
      conn.cancel()
    }
  }

  /// Tear the whole listener + all sockets down (idempotent).
  @objc(stop:rejecter:)
  func stop(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async { [weak self] in
      self?.tearDownLocked()
      resolve(nil)
    }
  }

  // MARK: - Bind loop (port fallback)

  private func tryBind(
    from port: Int,
    attemptsLeft: Int,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard attemptsLeft > 0, let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
      reject("signaling_bind_failed", "No free port in range for the signalling server", nil)
      return
    }
    let params = NWParameters.tcp
    params.allowLocalEndpointReuse = true
    guard let newListener = try? NWListener(using: params, on: nwPort) else {
      // Construction failure → try the next port.
      self.tryBind(from: port + 1, attemptsLeft: attemptsLeft - 1, resolve: resolve, reject: reject)
      return
    }
    newListener.stateUpdateHandler = { [weak self] state in
      guard let self = self else { return }
      switch state {
      case .ready:
        self.listener = newListener
        resolve(NSNumber(value: port))
      case .failed:
        // Likely the port is in use → fall through to the next candidate.
        newListener.cancel()
        self.queue.async {
          self.tryBind(from: port + 1, attemptsLeft: attemptsLeft - 1, resolve: resolve, reject: reject)
        }
      default:
        break
      }
    }
    newListener.newConnectionHandler = { [weak self] connection in
      self?.accept(connection)
    }
    newListener.start(queue: queue)
  }

  // MARK: - Connection lifecycle

  private func accept(_ connection: NWConnection) {
    connection.start(queue: queue)
    // Read the HTTP upgrade request (small; arrives in one or a few segments).
    readHandshake(connection, buffer: Data())
  }

  private func readHandshake(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
      [weak self] data, _, isComplete, error in
      guard let self = self else { return }
      if let error = error {
        self.emit(SignalingServer.evError, ["message": "handshake read error: \(error.localizedDescription)"])
        connection.cancel()
        return
      }
      var acc = buffer
      if let data = data { acc.append(data) }
      guard let headerEnd = acc.range(of: Data("\r\n\r\n".utf8)) else {
        if isComplete {
          connection.cancel()
          return
        }
        // Need more bytes for the full header.
        self.readHandshake(connection, buffer: acc)
        return
      }
      let headerData = acc.subdata(in: acc.startIndex..<headerEnd.lowerBound)
      guard let header = String(data: headerData, encoding: .utf8) else {
        connection.cancel()
        return
      }
      self.completeUpgrade(connection, header: header)
    }
  }

  private func completeUpgrade(_ connection: NWConnection, header: String) {
    // Validate the shared secret from the request line query (?secret=...).
    let providedSecret = SignalingServer.querySecret(fromRequestLine: header)
    guard SignalingServer.constantTimeEquals(providedSecret, sharedSecret) else {
      // Reject: do NOT upgrade. Send 401 and close. Never log the secret.
      let resp = "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"
      connection.send(content: Data(resp.utf8), completion: .contentProcessed { _ in
        connection.cancel()
      })
      return
    }
    // Derive Sec-WebSocket-Accept from the client's key.
    guard let key = SignalingServer.headerValue(header, "sec-websocket-key") else {
      connection.cancel()
      return
    }
    let accept = SignalingServer.computeAccept(key)
    let response = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Accept: \(accept)",
      "", "",
    ].joined(separator: "\r\n")

    connection.send(content: Data(response.utf8), completion: .contentProcessed { [weak self] sendError in
      guard let self = self else { return }
      if sendError != nil {
        connection.cancel()
        return
      }
      let clientId = UUID().uuidString
      self.queue.async {
        self.clients[clientId] = connection
        self.emit(SignalingServer.evConnection, ["clientId": clientId])
        self.observeClose(connection, clientId: clientId)
        self.readFrames(connection, clientId: clientId, buffer: Data())
      }
    })
  }

  private func observeClose(_ connection: NWConnection, clientId: String) {
    connection.stateUpdateHandler = { [weak self] state in
      guard let self = self else { return }
      switch state {
      case .failed, .cancelled:
        self.queue.async {
          if self.clients.removeValue(forKey: clientId) != nil {
            self.emit(SignalingServer.evClose, ["clientId": clientId])
          }
        }
      default:
        break
      }
    }
  }

  // MARK: - WebSocket frame codec (RFC 6455, text subset)

  private func readFrames(_ connection: NWConnection, clientId: String, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
      [weak self] data, _, isComplete, error in
      guard let self = self else { return }
      if error != nil || (isComplete && data == nil) {
        connection.cancel()
        return
      }
      var acc = buffer
      if let data = data { acc.append(data) }
      // Drain as many complete frames as the buffer holds.
      while true {
        let result = SignalingServer.decodeFrame(acc)
        switch result {
        case .needMore:
          self.readFrames(connection, clientId: clientId, buffer: acc)
          return
        case .text(let payload, let rest):
          acc = rest
          self.emit(SignalingServer.evMessage, ["clientId": clientId, "data": payload])
        case .close(let rest):
          _ = rest
          connection.cancel()
          return
        case .ping(let appData, let rest):
          acc = rest
          self.sendPong(appData, over: connection)
        case .skip(let rest):
          // Pong / binary / continuation we don't act on — drop and continue.
          acc = rest
        case .protocolError:
          // RFC 6455 violation (unmasked client frame, or a fragmented text
          // frame we don't reassemble): close with 1002 rather than acting on a
          // partial/unmasked payload, then tear the socket down.
          self.sendClose(code: 1002, over: connection)
          connection.cancel()
          return
        case .invalid:
          connection.cancel()
          return
        }
      }
    }
  }

  /// Send a text frame (server→client frames are NOT masked, per RFC 6455).
  private func sendText(_ text: String, over connection: NWConnection) {
    let payload = Data(text.utf8)
    var frame = Data()
    frame.append(0x81) // FIN + opcode 0x1 (text)
    SignalingServer.appendLength(&frame, payload.count, masked: false)
    frame.append(payload)
    connection.send(content: frame, completion: .contentProcessed { _ in })
  }

  private func sendPong(_ appData: Data, over connection: NWConnection) {
    var frame = Data()
    frame.append(0x8A) // FIN + opcode 0xA (pong)
    SignalingServer.appendLength(&frame, appData.count, masked: false)
    frame.append(appData)
    connection.send(content: frame, completion: .contentProcessed { _ in })
  }

  /// Send a close frame with a 2-byte status code (server→client is unmasked).
  private func sendClose(code: UInt16, over connection: NWConnection) {
    var frame = Data()
    frame.append(0x88) // FIN + opcode 0x8 (close)
    let payload = Data([UInt8(code >> 8), UInt8(code & 0xFF)])
    SignalingServer.appendLength(&frame, payload.count, masked: false)
    frame.append(payload)
    connection.send(content: frame, completion: .contentProcessed { _ in })
  }

  private static func appendLength(_ frame: inout Data, _ length: Int, masked: Bool) {
    let maskBit: UInt8 = masked ? 0x80 : 0x00
    if length < 126 {
      frame.append(UInt8(length) | maskBit)
    } else if length <= 0xFFFF {
      frame.append(126 | maskBit)
      frame.append(UInt8((length >> 8) & 0xFF))
      frame.append(UInt8(length & 0xFF))
    } else {
      frame.append(127 | maskBit)
      for shift in stride(from: 56, through: 0, by: -8) {
        frame.append(UInt8((length >> shift) & 0xFF))
      }
    }
  }

  /// The outcome of attempting to decode ONE frame from the front of `data`.
  private enum DecodeResult {
    case needMore
    case text(String, rest: Data)
    case close(rest: Data)
    case ping(Data, rest: Data)
    case skip(rest: Data)
    /// RFC 6455 violation by the peer (e.g. an unmasked client frame or a
    /// fragmented text frame). The caller should send a 1002 close and tear down.
    case protocolError
    /// Malformed beyond a clean close-code response (e.g. invalid UTF-8 text).
    case invalid
  }

  /// Decode a single client→server frame. Client frames MUST be masked (RFC 6455
  /// §5.1); a fragmented text frame (FIN=0) is rejected since we don't reassemble.
  private static func decodeFrame(_ data: Data) -> DecodeResult {
    let bytes = [UInt8](data)
    guard bytes.count >= 2 else { return .needMore }
    let fin = (bytes[0] & 0x80) != 0
    let opcode = bytes[0] & 0x0F
    let masked = (bytes[1] & 0x80) != 0
    var len = Int(bytes[1] & 0x7F)
    var offset = 2
    if len == 126 {
      guard bytes.count >= 4 else { return .needMore }
      len = (Int(bytes[2]) << 8) | Int(bytes[3])
      offset = 4
    } else if len == 127 {
      guard bytes.count >= 10 else { return .needMore }
      len = 0
      for i in 2..<10 { len = (len << 8) | Int(bytes[i]) }
      offset = 10
    }
    // A client frame that arrives UNMASKED violates RFC 6455 §5.1. Once we have
    // the length header we know we have enough bytes to make this verdict; close
    // rather than xor-decode garbage or pass an unmasked payload upward.
    if !masked { return .protocolError }
    var maskKey: [UInt8] = [0, 0, 0, 0]
    guard bytes.count >= offset + 4 else { return .needMore }
    maskKey = Array(bytes[offset..<offset + 4])
    offset += 4
    guard bytes.count >= offset + len else { return .needMore }
    var payload = Array(bytes[offset..<offset + len])
    for i in 0..<payload.count { payload[i] ^= maskKey[i % 4] }
    let rest = data.subdata(in: data.index(data.startIndex, offsetBy: offset + len)..<data.endIndex)
    switch opcode {
    case 0x1: // text
      // We don't reassemble fragments, so a non-final text frame is a protocol
      // error rather than a silently-truncated message.
      guard fin else { return .protocolError }
      guard let text = String(bytes: payload, encoding: .utf8) else { return .invalid }
      return .text(text, rest: rest)
    case 0x8: // close
      return .close(rest: rest)
    case 0x9: // ping
      return .ping(Data(payload), rest: rest)
    default: // pong (0xA) / binary (0x2) / continuation (0x0)
      return .skip(rest: rest)
    }
  }

  // MARK: - Handshake helpers

  private static func computeAccept(_ key: String) -> String {
    let digest = Insecure.SHA1.hash(data: Data((key + wsGUID).utf8))
    return Data(digest).base64EncodedString()
  }

  /// Extract a header value (case-insensitive name) from the raw request header.
  private static func headerValue(_ header: String, _ name: String) -> String? {
    for line in header.split(separator: "\r\n") {
      let parts = line.split(separator: ":", maxSplits: 1)
      if parts.count == 2, parts[0].trimmingCharacters(in: .whitespaces).lowercased() == name {
        return parts[1].trimmingCharacters(in: .whitespaces)
      }
    }
    return nil
  }

  /// Parse `?secret=<value>` from the request line (`GET /path?query HTTP/1.1`).
  private static func querySecret(fromRequestLine header: String) -> String {
    guard let firstLine = header.split(separator: "\r\n").first else { return "" }
    let tokens = firstLine.split(separator: " ")
    guard tokens.count >= 2 else { return "" }
    let target = String(tokens[1])
    guard let qIndex = target.firstIndex(of: "?") else { return "" }
    let query = target[target.index(after: qIndex)...]
    for pair in query.split(separator: "&") {
      let kv = pair.split(separator: "=", maxSplits: 1)
      if kv.count == 2, kv[0] == "secret" {
        return String(kv[1]).removingPercentEncoding ?? String(kv[1])
      }
    }
    return ""
  }

  /// Constant-time string comparison so the auth check does not leak via timing.
  private static func constantTimeEquals(_ a: String, _ b: String) -> Bool {
    let ab = [UInt8](a.utf8)
    let bb = [UInt8](b.utf8)
    if ab.count != bb.count { return false }
    var diff: UInt8 = 0
    for i in 0..<ab.count { diff |= ab[i] ^ bb[i] }
    return diff == 0
  }

  // MARK: - Teardown

  private func tearDownLocked() {
    listener?.cancel()
    listener = nil
    for (_, conn) in clients { conn.cancel() }
    clients.removeAll()
  }
}
