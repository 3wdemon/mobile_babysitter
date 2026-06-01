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
} from './videoTrackController';
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
  DEFAULT_ICE_SERVERS,
} from './peerConnection';
export {
  createLoopbackTransportPair,
  createLocalSocketTransport,
} from './signalingTransport';
export { SignalingSession, createSignalingSession } from './signalingSession';
export type {
  SignalingSessionStatus,
  SignalingSessionOptions,
} from './signalingSession';
export { useSignaling } from './useSignaling';
export type { UseSignalingOptions, UseSignalingState } from './useSignaling';

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
export { noopAudioPlayback, createSafeAudioPlayback } from './audioPlayback';
export { useAudioStream } from './useAudioStream';
export type { AudioPlayback } from './audioPlayback';
export type {
  UseAudioStreamOptions,
  UseAudioStreamState,
} from './useAudioStream';
export type {
  MediaStreamLike,
  MediaStreamTrackLike,
  MediaDevicesLike,
  MediaStreamConstraints,
  TrackEventLike,
  MediaEncryptionProfile,
} from './mediaTypes';
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
} from './signalingTypes';
export type { LocalSocketTransportConfig } from './signalingTransport';
