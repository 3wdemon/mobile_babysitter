import Foundation
import AVFoundation
import React

/// AudioSessionModule — keeps remote monitor audio playing while the parent
/// device's screen is locked, WITHOUT CallKit / PushKit (DMY-48).
///
/// ## Why no CallKit
/// CallKit + PushKit VoIP push (the "proper" way to keep a call alive in the
/// background) require a PAID Apple Developer account and the VoIP `aps-
/// environment` / "Voice over IP" background-mode entitlement. For the $0 MVP we
/// instead configure a plain `AVAudioSession` with the `.playAndRecord` category
/// and the `audio` value in `UIBackgroundModes` (Info.plist). An active
/// play-and-record session is enough for iOS to keep delivering audio to the app
/// while it is backgrounded / the screen is locked — no entitlement needed.
///
/// ## Contract (mirrors the TS `AudioSession` seam)
///  - `activate`   — set the `.playAndRecord` category with `.voiceChat` mode and
///                   make the session active. Resolves on success, rejects with a
///                   coded error the JS safe-wrapper swallows on failure.
///  - `deactivate` — release the session on teardown so iOS reclaims the audio
///                   focus (other apps' audio can resume).
///
/// The module owns NO media content and logs nothing: routing the WebRTC remote
/// track to the speaker is react-native-webrtc's job; this module only holds the
/// session category/mode that keeps that playback alive in the background.
@objc(AudioSessionModule)
final class AudioSessionModule: NSObject {

  /// React Native does not need this module on the main/JS thread at launch; the
  /// AVAudioSession calls are cheap and safe off the main queue.
  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  /// Configure and activate a `.playAndRecord` / `.voiceChat` audio session so
  /// remote audio keeps playing with the screen locked (AC1). Idempotent: calling
  /// it on an already-active session simply re-applies the category and re-asserts
  /// active, which AVAudioSession tolerates.
  @objc(activate:rejecter:)
  func activate(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let session = AVAudioSession.sharedInstance()
    do {
      // `.playAndRecord` is required because the baby-unit path also captures the
      // mic (two-way talk, DMY-20) and because a play-only category would not keep
      // the duplex VoIP-style session alive in the background. `.voiceChat` mode
      // applies the right signal processing / routing defaults for a call.
      // `.allowBluetooth` + `.defaultToSpeaker` keep room-fill speaker output and
      // headset routing working (DMY-55 picks the concrete route on top of this).
      try session.setCategory(
        .playAndRecord,
        mode: .voiceChat,
        options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
      )
      try session.setActive(true, options: [])
      resolve(nil)
    } catch {
      reject(
        "audio_session_activate_failed",
        "Failed to activate AVAudioSession: \(error.localizedDescription)",
        error
      )
    }
  }

  /// Tear the session down on stop()/unmount so iOS releases audio focus and the
  /// mic indicator clears. `.notifyOthersOnDeactivation` lets other apps' audio
  /// resume. Idempotent: deactivating an inactive session is a no-op error we
  /// still resolve through (a failed teardown must never crash the JS side).
  @objc(deactivate:rejecter:)
  func deactivate(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setActive(false, options: [.notifyOthersOnDeactivation])
      resolve(nil)
    } catch {
      reject(
        "audio_session_deactivate_failed",
        "Failed to deactivate AVAudioSession: \(error.localizedDescription)",
        error
      )
    }
  }
}
