/**
 * useAudioOnlyMode — drives the parent-unit audio-only low-power mode (DMY-24).
 *
 * Contract:
 *  - When `settings.audioOnlyEnabled` is `true`, the parent does NOT request the
 *    remote video track: the hook keeps video DISABLED on entry and never calls
 *    `enableVideo` on its own. Audio is unaffected (audio is handled elsewhere).
 *  - The user can momentarily PEEK at the picture: `showVideo()` enables the
 *    video track temporarily; `hideVideo()` returns to audio-only and disables
 *    it again. A peek does NOT change the persisted `audioOnlyEnabled` setting.
 *  - When `settings.audioOnlyEnabled` is `false`, the parent is in full video
 *    mode: the video track is requested (`enableVideo`) and stays on.
 *
 * The actual video-track control is abstracted behind {@link VideoTrackController}
 * (see ./videoTrackController). The shipped default is a SAFE NO-OP; the real
 * peer-connection-backed controller lands in DMY-17 and plugs into the same
 * contract. This hook owns only the SEQUENCING (when video is allowed to be
 * requested) — honestly nothing more, since there is no media layer yet.
 *
 * The controller is INJECTED. Production passes the WebRTC-backed controller;
 * tests pass a spy; omitted -> safe no-op. The hook holds ONE wrapped controller
 * instance per (lifetime × controller identity) so sequencing is stable across
 * ordinary re-renders.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppStore } from '../../store/useAppStore';
import { createSafeVideoTrackController } from './videoTrackController';
import type { ParentMediaMode, VideoTrackController } from './types';

export interface UseAudioOnlyModeOptions {
  /**
   * Video-track controller. Omit to use the safe no-op (until the WebRTC layer
   * is wired in DMY-17). Changing the controller identity re-syncs the track.
   */
  readonly controller?: VideoTrackController;
}

export interface AudioOnlyModeState {
  /** Whether the user has audio-only enabled in settings (persisted). */
  readonly audioOnlyEnabled: boolean;
  /**
   * The media currently being requested: `'audio-only'` while audio-only is on
   * and the user is not peeking; `'video'` otherwise.
   */
  readonly mode: ParentMediaMode;
  /** Whether the user is momentarily peeking at video while audio-only is on. */
  readonly isPeeking: boolean;
  /**
   * Momentarily request video while audio-only is on (peek at the picture).
   * No-op when audio-only is off (video is already requested).
   */
  readonly showVideo: () => void;
  /** End a peek and return to audio-only. No-op when audio-only is off. */
  readonly hideVideo: () => void;
}

export function useAudioOnlyMode(
  options: UseAudioOnlyModeOptions = {},
): AudioOnlyModeState {
  const { controller } = options;

  const audioOnlyEnabled = useAppStore(s => s.settings.audioOnlyEnabled);

  // Momentary peek state. Only meaningful while audio-only is on; ignored in
  // full video mode (where video is always requested anyway).
  const [isPeeking, setIsPeeking] = useState(false);

  // One wrapped controller per (hook lifetime × controller identity). PURE
  // factory: only constructs, no side-effect during render. Rebuilt only when
  // the controller identity changes so sequencing is stable across re-renders.
  const safeController = useMemo(
    () => createSafeVideoTrackController(controller),
    [controller],
  );

  // Resolve whether video should currently be requested:
  //  - audio-only OFF  -> always request video (full video mode).
  //  - audio-only ON   -> request video ONLY while peeking.
  const videoRequested = !audioOnlyEnabled || isPeeking;

  // A peek belongs to the current audio-only session. If the user turns
  // audio-only OFF mid-peek (now full video), or the setting otherwise changes,
  // drop the stale peek flag so `mode`/`isPeeking` stay coherent. Done in an
  // effect (state update), never during render.
  useEffect(() => {
    if (!audioOnlyEnabled && isPeeking) {
      setIsPeeking(false);
    }
  }, [audioOnlyEnabled, isPeeking]);

  // Drive the controller from the resolved `videoRequested` condition. Keyed on
  // `safeController` too so a swapped controller re-syncs to the current desired
  // track state. CRUCIAL for the AC: on entry with audio-only ON and no peek,
  // `videoRequested` is false -> `disableVideo` (never `enableVideo`), so the
  // video track is NOT requested.
  useEffect(() => {
    if (videoRequested) {
      safeController.enableVideo();
    } else {
      safeController.disableVideo();
    }
  }, [safeController, videoRequested]);

  // Safety net: stop requesting video on unmount so a swapped/torn-down
  // controller never leaks an open video track. Keyed on `safeController` so a
  // replaced controller's predecessor is also cleaned up.
  const controllerRef = useRef(safeController);
  useEffect(() => {
    const previous = controllerRef.current;
    if (previous !== safeController) {
      previous.disableVideo();
      controllerRef.current = safeController;
    }
  }, [safeController]);
  useEffect(() => {
    return () => {
      safeController.disableVideo();
    };
  }, [safeController]);

  const showVideo = useCallback(() => {
    // Peeking only makes sense while audio-only is on; in full video mode video
    // is already requested, so this is a no-op there.
    setIsPeeking(prev => prev || true);
  }, []);

  const hideVideo = useCallback(() => {
    setIsPeeking(false);
  }, []);

  const mode: ParentMediaMode = videoRequested ? 'video' : 'audio-only';

  return {
    audioOnlyEnabled,
    mode,
    // Only report peeking while audio-only is on; in full video mode it is moot.
    isPeeking: audioOnlyEnabled && isPeeking,
    showVideo,
    hideVideo,
  };
}
