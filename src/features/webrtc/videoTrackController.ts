/**
 * videoTrackController — the integration point for parent-unit video-track
 * control under audio-only mode (DMY-24), now with a REAL peer-connection-backed
 * implementation (DMY-17).
 *
 * The audio-only mode logic (useAudioOnlyMode) funnels every "show / hide the
 * picture" decision through the abstract {@link VideoTrackController}:
 *  - the shipped DEFAULT is still a safe no-op (used under Jest, in a bare JS
 *    context, or when no media layer is wired), and
 *  - {@link createSenderVideoTrackController} (DMY-17) provides the REAL
 *    controller backed by an `RTCRtpSender` / transceiver: `enableVideo` resumes
 *    the outgoing video track and flips the transceiver to `sendonly`;
 *    `disableVideo` pauses it (`replaceTrack(null)` + `inactive`) so video is
 *    genuinely NOT transmitted in audio-only mode. This REPLACES the no-op stub
 *    from DMY-24 in production — audio-only now really controls the video media,
 *    and a peek really turns it back on.
 *
 * Every call is wrapped so a flaky/real controller can never crash a monitoring
 * session, and only coarse, non-PII facts are logged (no media, ids or audio).
 */
import { logger } from '../../services/logger';
import type { RtpSenderLike, RtpTransceiverLike } from './mediaTypes';
import type { VideoTrackController } from './types';

/**
 * Safe no-op controller used when no WebRTC controller is wired (e.g. under
 * Jest, in a bare JS context, or before DMY-17). Satisfies the contract without
 * touching any media API.
 */
export const noopVideoTrackController: VideoTrackController = {
  enableVideo: () => {},
  disableVideo: () => {},
};

/** Run a controller call, swallowing+logging any error so it never propagates. */
function safe(label: string, fn: () => void): void {
  try {
    fn();
  } catch {
    // Coarse, non-PII diagnostic only.
    logger.warn('webrtc/audio-only: controller call failed', { op: label });
  }
}

/**
 * Wrap a {@link VideoTrackController} so its calls never throw and are logged at
 * a coarse level. The hook always drives the wrapped controller.
 *
 * @param controller The real controller (DMY-17) or undefined for the no-op.
 */
export function createSafeVideoTrackController(
  controller: VideoTrackController = noopVideoTrackController,
): VideoTrackController {
  return {
    enableVideo: () => {
      safe('enableVideo', () => controller.enableVideo());
      logger.info('webrtc/audio-only: video enabled');
    },
    disableVideo: () => {
      safe('disableVideo', () => controller.disableVideo());
      logger.info('webrtc/audio-only: video disabled');
    },
  };
}

/**
 * Options for the real, sender-backed {@link VideoTrackController} (DMY-17).
 */
export interface SenderVideoTrackControllerOptions {
  /**
   * The `RTCRtpSender` for the outgoing video track (the handle returned by
   * `PeerConnection.addVideoTrack`). `enableVideo`/`disableVideo` resume/pause
   * its track via `replaceTrack` — pausing genuinely stops sending video.
   */
  readonly sender: RtpSenderLike | null | undefined;
  /**
   * The video track to (re)attach on `enableVideo`. Captured once on the
   * baby-unit; held so a paused track can be restored without re-capturing.
   */
  readonly track: import('./mediaTypes').MediaStreamTrackLike | null | undefined;
  /**
   * Optional transceiver for the video m-line. When provided, its `direction`
   * is flipped to `'sendonly'` (enable) / `'inactive'` (disable) so the SDP
   * direction matches the send state. Optional because `replaceTrack` alone is
   * enough to stop bytes flowing; the direction flip is belt-and-braces.
   */
  readonly transceiver?: RtpTransceiverLike | null;
}

/**
 * Build the REAL video-track controller (DMY-17), backed by an `RTCRtpSender`
 * (and optionally its transceiver). This is the controller that REPLACES the
 * DMY-24 no-op stub in production:
 *
 *  - {@link VideoTrackController.enableVideo}: re-attaches the captured video
 *    track to the sender (`replaceTrack(track)`) so frames flow again, and (if a
 *    transceiver is supplied) sets `direction = 'sendonly'`. Used when the user
 *    leaves audio-only or peeks at the picture.
 *  - {@link VideoTrackController.disableVideo}: detaches the track
 *    (`replaceTrack(null)`) so NO video is transmitted, and sets
 *    `direction = 'inactive'`. Used on entering audio-only and when a peek ends.
 *
 * Neither operation renegotiates or recreates the connection — `replaceTrack`
 * and a `direction` flip act on the LIVE sender, so toggling video never drops
 * the session. The promises returned by `replaceTrack` are intentionally not
 * awaited here (the contract is fire-and-forget, synchronous-looking) but are
 * `.catch`-guarded so a rejection cannot surface as an unhandled rejection.
 *
 * The returned controller is raw; callers wrap it with
 * {@link createSafeVideoTrackController} so individual calls never throw.
 */
export function createSenderVideoTrackController(
  options: SenderVideoTrackControllerOptions,
): VideoTrackController {
  const { sender, track, transceiver } = options;

  const swallow = (): void => {
    // replaceTrack rejection is non-fatal: log coarse, never propagate.
    logger.warn('webrtc/video: replaceTrack rejected');
  };

  return {
    enableVideo: () => {
      if (transceiver) {
        transceiver.direction = 'sendonly';
      }
      if (sender && typeof sender.replaceTrack === 'function') {
        Promise.resolve(sender.replaceTrack(track ?? null)).catch(swallow);
      }
    },
    disableVideo: () => {
      if (sender && typeof sender.replaceTrack === 'function') {
        Promise.resolve(sender.replaceTrack(null)).catch(swallow);
      }
      if (transceiver) {
        transceiver.direction = 'inactive';
      }
    },
  };
}
