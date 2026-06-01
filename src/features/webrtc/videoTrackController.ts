/**
 * videoTrackController — the integration point for parent-unit video-track
 * control under audio-only mode (DMY-24).
 *
 * Design boundary (HONEST): there is NO real WebRTC in this issue. The shipped
 * default is a SAFE NO-OP. When the media layer lands (DMY-17) it will provide a
 * real {@link VideoTrackController} backed by the peer connection — flipping an
 * `RTCRtpSender` / transceiver direction or renegotiating the video m-line —
 * and plug into this exact same contract. Until then the hook drives this no-op
 * so the audio-only sequencing is fully testable without a native dependency.
 *
 * Every call is wrapped so a flaky/real controller can never crash a monitoring
 * session, and only coarse, non-PII facts are logged (no media, ids or audio).
 */
import { logger } from '../../services/logger';
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
