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
