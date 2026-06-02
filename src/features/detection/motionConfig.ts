/**
 * Default motion-detection tuning (DMY-25).
 *
 * Metrics are expressed on a normalised 0..1 motion scale (e.g. the fraction of
 * pixels that changed between consecutive frames), which the abstract source
 * (DMY-17 video + DMY-45 CV) is expected to provide. A concrete source can map
 * its native units onto this range, or callers can override the whole config.
 *
 *  - `enterThreshold` 0.15 — ~15% of the frame changing counts as real motion
 *    (above sensor noise / lighting flicker).
 *  - `exitThreshold`  0.08 — hysteresis gap so a metric hovering near the trigger
 *    does not chatter between moving/still.
 *  - `cooldownMs` 5000 — at most one `motion` event per 5s, so continuous
 *    fidgeting does not spam alerts.
 *  - `noMotionThresholdMs` 30000 — fire a single `no_motion` event after 30s of
 *    continuous stillness (the DMY-25 acceptance threshold).
 *
 * These are conservative defaults; the user-facing sensitivity maps onto
 * `enterThreshold` via the store (`settings.motionSensitivity`).
 */
import type { MotionDetectorConfig } from './motionTypes';

/**
 * Continuous-stillness duration (ms) after which a `no_motion` event fires.
 * 30s per the DMY-25 acceptance criteria. Configurable per-detector via
 * {@link MotionDetectorConfig.noMotionThresholdMs}.
 */
export const NO_MOTION_THRESHOLD_MS = 30000;

export const DEFAULT_MOTION_CONFIG: Required<MotionDetectorConfig> = {
  enterThreshold: 0.15,
  exitThreshold: 0.08,
  cooldownMs: 5000,
  noMotionThresholdMs: NO_MOTION_THRESHOLD_MS,
};
