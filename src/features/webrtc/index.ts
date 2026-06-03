/**
 * Public surface of the parent-unit audio-only low-power feature (DMY-24).
 *
 * Audio-only is the lower-power, lower-bandwidth parent posture: audio is
 * received continuously while the remote video track is NOT requested; the user
 * can momentarily peek at the picture on demand. Actual video-track control is
 * abstracted behind {@link VideoTrackController}; the shipped default is a safe
 * no-op and the real peer-connection-backed controller plugs into the same
 * contract in DMY-17. Nothing here captures media or PII.
 */
export {
  noopVideoTrackController,
  createSafeVideoTrackController,
  createSenderVideoTrackController,
} from './videoTrackController';
export type { SenderVideoTrackControllerOptions } from './videoTrackController';
export { useAudioOnlyMode } from './useAudioOnlyMode';
export { default as ParentMediaView } from './ParentMediaView';
export type {
  AudioOnlyModeState,
  UseAudioOnlyModeOptions,
} from './useAudioOnlyMode';
export type { ParentMediaViewProps } from './ParentMediaView';
export type { ParentMediaMode, VideoTrackController } from './types';

// --- WebRTC signalling (DMY-16) -----------------------------------------
// PeerConnection wrapper + SignalingTransport abstraction + the signalling
// state machine. The state machine and loopback transport are fully functional;
// the real local socket transport is an integration point (see
// signalingTransport.ts). TURN is out of scope (DMY-19).
export {
  createPeerConnection,
  normalizePeerState,
  wrapDataChannel,
  DEFAULT_ICE_SERVERS,
} from './peerConnection';
export {
  createLoopbackTransportPair,
  createLocalSocketTransport,
  buildSignalingUrl,
  defaultSignalingServerFactory,
} from './signalingTransport';
export { SignalingSession, createSignalingSession } from './signalingSession';
export type {
  SignalingSessionStatus,
  SignalingSessionOptions,
} from './signalingSession';
export { useSignaling } from './useSignaling';
export type { UseSignalingOptions, UseSignalingState } from './useSignaling';

// --- Reconnect: exponential backoff + UI feedback (DMY-61) --------------------
// PURE backoff policy + an injectable-clock/RNG controller that paces auto-
// reconnect on an UNCLEAN drop, up to a hard attempt cap (no infinite loop).
// Wired into useSignaling; the ReconnectingBanner renders the state.
export {
  nextDelayMs,
  createReconnectController,
  DEFAULT_RECONNECT_POLICY,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
} from './reconnectPolicy';
export type {
  ReconnectPolicy,
  ReconnectController,
  ReconnectControllerOptions,
  ReconnectSnapshot,
  PeerLikeState,
  Rng,
} from './reconnectPolicy';

// --- Audio stream: baby→parent over WebRTC, DTLS-SRTP (DMY-18) -----------
// One-way audio capture/publish (baby) + remote-track playback (parent) on top
// of the signalling handshake. Microphone capture is real (against the injected
// mediaDevices); audio ROUTING (loud speaker / background VoIP session) is the
// AudioPlayback integration point and lands with the in-call work (DMY-9) — the
// shipped default is a safe no-op. Media is encrypted by WebRTC's DTLS-SRTP and
// cannot be disabled; assertEncryptedMediaProfile confirms the SRTP profile.
export {
  getLocalAudioStream,
  stopStream,
  setStreamAudioEnabled,
  audioTracksOf,
  extractRemoteAudioStream,
  assertEncryptedMediaProfile,
  AUDIO_ONLY_CONSTRAINTS,
} from './audioStream';
export {
  noopAudioPlayback,
  createSafeAudioPlayback,
  createAudioSessionPlayback,
  availableRoutesFor,
  clampVolume,
  AUDIO_ROUTES,
  DEFAULT_AUDIO_ROUTE,
} from './audioPlayback';
export { useAudioStream } from './useAudioStream';
export type {
  AudioPlayback,
  AudioRoute,
  AudioSession,
} from './audioPlayback';

// --- iOS background audio session: AVAudioSession, no CallKit/PushKit (DMY-48) -
// $0 alternative to DMY-22: a .playAndRecord/.voiceChat AVAudioSession (Swift
// AudioSessionModule) + UIBackgroundModes:['audio'] keeps remote audio playing
// with the screen locked WITHOUT a paid VoIP entitlement. start() activates the
// session, stop() deactivates it; on Android / under Jest the native module is
// absent and this degrades to a safe no-op.
export {
  createIosAudioPlayback,
  createIosAudioSessionPlayback,
  resolveAudioSessionModule,
} from './iosAudioPlayback';
export type { AudioSessionNativeModule } from './iosAudioPlayback';

// --- Android background audio: foreground service, no ConnectionService (DMY-23) -
// Android mirror of DMY-48: a plain started Foreground Service (Kotlin
// AudioForegroundService + AudioForegroundModule bridge) with a persistent
// notification and microphone|mediaPlayback foregroundServiceType keeps remote
// audio playing when the parent backgrounds / locks. start() promotes to the
// foreground service, stop() tears it down; on iOS / under Jest the native
// module is absent and this degrades to a safe no-op. Wired into useMediaSession.
export {
  createAndroidAudioService,
  noopAndroidAudioService,
  resolveAndroidAudioModule,
} from './androidAudioService';
export type {
  AndroidAudioService,
  AndroidAudioForegroundNativeModule,
} from './androidAudioService';

// --- Two-way talk: parent→baby push-to-talk + echo cancellation (DMY-20) -----
// The parent captures its own mic with native echo cancellation (TALK_AUDIO_
// CONSTRAINTS: echoCancellation/noiseSuppression/autoGainControl) and publishes
// a DISABLED push-to-talk track onto the SAME (DTLS-SRTP) peer connection; the
// baby plays the parent's incoming voice. Half-duplex push-to-talk (mic open
// only while the talk button is held) + native AEC minimise feedback. Real
// cross-device audio is a manual milestone (no devices/network in CI); every
// seam used to do it (capture, track enable/disable, ontrack playback) is real.
export {
  getTalkbackAudioStream,
  createTalkbackController,
  requestsEchoCancellation,
  TALK_AUDIO_CONSTRAINTS,
} from './talkback';
export type { TalkbackController } from './talkback';
export { default as TalkButton } from './TalkButton';
export type { TalkButtonProps } from './TalkButton';
export type {
  UseAudioStreamOptions,
  UseAudioStreamState,
} from './useAudioStream';
export type {
  MediaStreamLike,
  MediaStreamTrackLike,
  MediaDevicesLike,
  MediaStreamConstraints,
  AudioConstraints,
  VideoConstraints,
  TrackEventLike,
  MediaEncryptionProfile,
  RtpSenderLike,
  RtpSendParametersLike,
  RtpEncodingLike,
  RtpTransceiverLike,
} from './mediaTypes';

// --- Video stream: baby→parent over WebRTC, 1080p + adaptive bitrate (DMY-17) -
// One-way video capture/publish (baby, 1080p with device-step-down) + remote
// video render (parent, RTCView). Adaptive bitrate reshapes the LIVE sender via
// setParameters (no renegotiation / reconnect); the bandwidth signal source is
// abstracted (connection-state proxy by default; getStats-backed in prod). The
// real sender-backed VideoTrackController replaces the DMY-24 no-op so audio-only
// genuinely pauses the outgoing video. Video media is SRTP (assertEncrypted-
// MediaProfile covers the video m-line). Real cross-device frames are a manual
// milestone (no devices/network in CI); every seam used to do it is real.
export {
  getLocalVideoStream,
  videoTracksOf,
  extractRemoteVideoStream,
  streamUrlOf,
  setVideoBitrate,
  nextQualityIndex,
  bandwidthSignalForState,
  VIDEO_1080P_CONSTRAINTS,
  VIDEO_CONSTRAINT_LADDER,
  VIDEO_QUALITY_LADDER,
  TOP_QUALITY_INDEX,
  BOTTOM_QUALITY_INDEX,
} from './videoStream';
export { useVideoStream } from './useVideoStream';
export type {
  LocalVideoCapture,
  VideoQualityProfile,
  BandwidthSignal,
  BandwidthSignalSource,
} from './videoStream';

// --- getStats-backed bandwidth source (DMY-45) -------------------------------
// Real adaptive-bitrate signal from RTCPeerConnection.getStats (packet loss +
// available outgoing bitrate), behind the existing BandwidthSignalSource seam.
export {
  createGetStatsBandwidthSource,
  classifyStats,
  readSnapshot,
  DEFAULT_STATS_POLL_MS,
  DEFAULT_LOSS_THRESHOLD,
  DEFAULT_MIN_BITRATE_BPS,
} from './bandwidthSource';
export type {
  RtcStatLike,
  RtcStatsReportLike,
  StatsReader,
  StatsSnapshot,
  GetStatsBandwidthSourceOptions,
} from './bandwidthSource';

// --- End-to-end media session + transport wiring (DMY-45) --------------------
// useMediaSession runs ONE signalling session carrying baby audio+video over a
// single peer connection; useSignalingTransport builds the REAL local socket
// transport (parent dials; baby listens via a native seam) for the screens.
export { useMediaSession } from './useMediaSession';
export type {
  UseMediaSessionOptions,
  UseMediaSessionState,
} from './useMediaSession';
export { useSignalingTransport } from './useSignalingTransport';
export type {
  SignalingEndpoint,
  UseSignalingTransportOptions,
} from './useSignalingTransport';
export type {
  UseVideoStreamOptions,
  UseVideoStreamState,
} from './useVideoStream';
export type {
  SignalingRole,
  SignalingMessage,
  SignalingMessageType,
  SignalingSdp,
  SignalingIceCandidate,
  SignalingTransport,
  PeerConnection,
  PeerConnectionState,
  PeerConnectionEvents,
  PeerConnectionFactory,
  PeerConnectionConfig,
  RtcIceServer,
  DataChannel,
} from './signalingTypes';
export type {
  RtcDataChannelLike,
  RtcPeerConnectionLike,
  RtcPeerConnectionCtor,
} from './peerConnection';
export type {
  LocalSocketTransportConfig,
  LocalSocketTransportOptions,
  SignalingServerFactory,
  WebSocketFactory,
  WebSocketLike,
} from './signalingTransport';
