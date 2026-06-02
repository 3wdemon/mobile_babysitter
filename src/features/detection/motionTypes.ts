/**
 * Types for motion / no-motion detection on the baby-unit (DMY-25).
 *
 * The detector operates on a stream of numeric MOTION-METRIC samples (an
 * abstract per-frame "how much changed" scalar — e.g. the fraction of pixels
 * that differ from the previous frame, or a motion-score from an on-device CV
 * pass). It does NOT touch raw frames, the camera, or WebRTC video tracks: the
 * real frame source (decoded WebRTC video — DMY-17 — plus an on-device CV /
 * frame-differencing step — DMY-45) lands later and plugs into the
 * {@link MotionMetricSource} integration point below.
 *
 * Privacy: a {@link MotionEvent} carries ONLY a motion metric, the threshold
 * and a timestamp — never a frame, pixel buffer, or anything from which an image
 * could be reconstructed. No frame is stored or logged.
 */

/**
 * A single motion-metric reading fed into the detector.
 *
 * `metric` is a unitless motion scalar on a normalised 0..1-ish scale (the
 * detector is agnostic to the exact scale; thresholds are configured in the same
 * units). A higher value means "more changed between frames" (more motion). It
 * is intentionally NOT frame/pixel data.
 */
export type MotionMetric = number;

/**
 * The kind of motion event emitted.
 *  - `'motion'`    — a rising edge into the moving band was detected (something
 *    moved in front of the baby-unit camera).
 *  - `'no_motion'` — no motion was observed CONTINUOUSLY for longer than the
 *    configured `noMotionThresholdMs` (default 30s). Useful as a "stillness"
 *    signal; product/UX decides whether that is reassuring or alarming.
 */
export type MotionEventType = 'motion' | 'no_motion';

/**
 * An emitted motion event. Privacy-first: contains only the metric (where
 * relevant), the threshold and when it happened — never any frame.
 */
export interface MotionEvent {
  /** Discriminant so detection kinds (noise/motion) can share an event bus. */
  readonly type: MotionEventType;
  /** Epoch milliseconds at which the event fired. */
  readonly timestamp: number;
  /**
   * The motion metric associated with the event:
   *  - for `'motion'`: the metric on the rising edge that triggered it.
   *  - for `'no_motion'`: the most recent metric seen (which, by definition, was
   *    below the exit threshold) — `null` if no sample was ever received.
   */
  readonly metric: MotionMetric | null;
  /** The enter-threshold the detector is configured with, for UI/log context. */
  readonly threshold: MotionMetric;
}

/**
 * Detector configuration.
 *
 * Hysteresis, cooldown and the no-motion timer exist to avoid event spam and to
 * express the >30s stillness rule:
 *  - `enterThreshold` — metric at/above which we treat the frame as MOVING:
 *    ARM and (subject to cooldown) emit a `'motion'` event.
 *  - `exitThreshold` — metric at/below which we treat the scene as STILL and
 *    disarm. The hysteresis gap stops a metric hovering near the trigger from
 *    chattering between motion/still. Must be `<= enterThreshold`.
 *  - `cooldownMs` — minimum time between two emitted `'motion'` events, even
 *    across separate rising edges. `0` disables it.
 *  - `noMotionThresholdMs` — how long the scene must remain continuously still
 *    (metric never crossing into the moving band) before a single `'no_motion'`
 *    event fires. Default 30000ms (30s) per the DMY-25 acceptance criteria. Any
 *    motion resets this timer; the event fires at most once per still stretch.
 */
export interface MotionDetectorConfig {
  /** Metric at/above which a frame counts as moving (and may fire `motion`). */
  readonly enterThreshold: MotionMetric;
  /**
   * Metric at/below which the detector disarms (hysteresis lower bound).
   * Defaults to `enterThreshold` (degenerate hysteresis) when omitted.
   */
  readonly exitThreshold?: MotionMetric;
  /** Minimum ms between emitted `motion` events. Defaults to `0` (no cooldown). */
  readonly cooldownMs?: number;
  /**
   * Continuous-stillness duration (ms) after which one `no_motion` event fires.
   * Defaults to {@link NO_MOTION_THRESHOLD_MS} (30000). Must be `> 0`.
   */
  readonly noMotionThresholdMs?: number;
}

/**
 * Result of feeding one metric sample into the detector.
 */
export interface MotionSampleResult {
  /** The event emitted by this sample, or `null` if none. */
  readonly event: MotionEvent | null;
  /** Whether the detector currently considers the scene to be moving. */
  readonly moving: boolean;
}

/**
 * Integration point for the real motion-metric source (DMY-17 video track +
 * DMY-45 on-device CV / frame differencing).
 *
 * A source pushes motion-metric samples to the supplied `onMetric` callback and
 * returns an unsubscribe function. The detector / hook is agnostic to where the
 * numbers come from — a frame-differencing tap over a decoded WebRTC video
 * track, a TFLite motion model, or a test stub all satisfy this contract. No
 * frame/pixel buffers cross this boundary, only scalar metrics.
 *
 * Because the no-motion rule is TIME-based, the source is expected to call
 * `onMetric` periodically (e.g. once per sampled frame) so the detector's
 * stillness timer is evaluated on a regular cadence. A `tick(metric)` helper on
 * the hook side lets a source also nudge the timer without a new frame; see
 * {@link MotionDetector.tick}.
 */
export type MotionMetricSource = (
  onMetric: (metric: MotionMetric) => void,
) => () => void;
