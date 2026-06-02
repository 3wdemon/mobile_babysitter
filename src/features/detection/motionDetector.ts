/**
 * motionDetector — pure motion / no-motion detection core (DMY-25).
 *
 * Stateful but framework-free: feed it motion-metric samples one at a time and
 * it decides whether the scene is MOVING or STILL, emitting a
 * {@link MotionEvent} on the interesting transitions. It has no React, no real
 * timers, no I/O and no video dependency — the metric numbers come from an
 * abstract source (decoded WebRTC video from DMY-17 + an on-device CV /
 * frame-differencing pass from DMY-45). The only time source is an INJECTED
 * `now()` clock, so all timing (cooldown + the 30s no-motion rule) is
 * deterministic and testable.
 *
 * Two kinds of event:
 *  - **`motion`** — a rising edge into the moving band (with hysteresis +
 *    cooldown to avoid spam).
 *  - **`no_motion`** — the scene stayed STILL continuously for longer than
 *    `noMotionThresholdMs` (default 30s). Fires AT MOST ONCE per still stretch;
 *    any motion resets the stillness timer.
 *
 * Design (anti-spam):
 *  - **Hysteresis**: a rising edge above `enterThreshold` arms the detector and
 *    fires a `motion` event; it only disarms once the metric drops to/below
 *    `exitThreshold`. A sustained moving stretch yields ONE `motion` event, and
 *    re-firing needs a genuine new rising edge. While in the hysteresis gap
 *    (between exit and enter) the scene is considered neither freshly-moving nor
 *    still, so the stillness timer is NOT advanced — it only runs once the
 *    metric is at/below `exitThreshold`.
 *  - **Cooldown**: two emitted `motion` events are at least `cooldownMs` apart,
 *    rate-limiting bursts of brief movement.
 *  - **No-motion timer**: stillness is timed from the moment the scene becomes
 *    still (metric <= exitThreshold). When `now - stillSince >= threshold` a
 *    single `no_motion` event fires; it will not fire again until motion resets
 *    the timer. Evaluated on every `push` AND on {@link MotionDetector.tick}, so
 *    a periodically-polling source can surface stillness even with no new frame.
 *  - **Edge cases**: `NaN`/`±Infinity`/non-finite samples are ignored (no event,
 *    no state change, timer untouched). Negative or extreme finite values are
 *    treated as ordinary metrics, compared against the configured thresholds.
 *
 * Privacy: emitted events contain only the motion metric, threshold and a
 * timestamp — never a frame.
 */
import { NO_MOTION_THRESHOLD_MS } from './motionConfig';
import type {
  MotionDetectorConfig,
  MotionEvent,
  MotionMetric,
  MotionSampleResult,
} from './motionTypes';

/**
 * Resolved config with defaults applied and invariants enforced.
 */
interface ResolvedConfig {
  readonly enterThreshold: number;
  readonly exitThreshold: number;
  readonly cooldownMs: number;
  readonly noMotionThresholdMs: number;
}

function resolveConfig(config: MotionDetectorConfig): ResolvedConfig {
  const { enterThreshold } = config;
  if (!Number.isFinite(enterThreshold)) {
    throw new Error(
      `motionDetector: enterThreshold must be a finite number, got ${enterThreshold}`,
    );
  }

  const exitThreshold = config.exitThreshold ?? enterThreshold;
  if (!Number.isFinite(exitThreshold)) {
    throw new Error(
      `motionDetector: exitThreshold must be a finite number, got ${exitThreshold}`,
    );
  }
  if (exitThreshold > enterThreshold) {
    throw new Error(
      `motionDetector: exitThreshold (${exitThreshold}) must be <= enterThreshold (${enterThreshold})`,
    );
  }

  const cooldownMs = config.cooldownMs ?? 0;
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new Error(
      `motionDetector: cooldownMs must be a finite number >= 0, got ${cooldownMs}`,
    );
  }

  const noMotionThresholdMs =
    config.noMotionThresholdMs ?? NO_MOTION_THRESHOLD_MS;
  if (!Number.isFinite(noMotionThresholdMs) || noMotionThresholdMs <= 0) {
    throw new Error(
      `motionDetector: noMotionThresholdMs must be a finite number > 0, got ${noMotionThresholdMs}`,
    );
  }

  return { enterThreshold, exitThreshold, cooldownMs, noMotionThresholdMs };
}

/**
 * A stateful motion detector. Create one per monitoring session and feed it
 * samples via {@link MotionDetector.push}; call {@link MotionDetector.tick}
 * periodically if the source does not deliver frames at a steady cadence.
 */
export class MotionDetector {
  private readonly config: ResolvedConfig;

  /** Injected clock for deterministic cooldown / no-motion timing. */
  private readonly now: () => number;

  /** Whether the scene is currently in the moving band (hysteresis state). */
  private moving = false;

  /** Timestamp of the last emitted `motion` event, or `null` if none yet. */
  private lastMotionAt: number | null = null;

  /**
   * Timestamp at which the current continuous-stillness stretch began, or `null`
   * when not currently still (moving, in the hysteresis gap, or no sample yet).
   */
  private stillSince: number | null = null;

  /** Whether a `no_motion` event has already fired for the current stretch. */
  private noMotionFired = false;

  /** Most recent finite metric seen, for `no_motion` event context. */
  private lastMetric: MotionMetric | null = null;

  constructor(config: MotionDetectorConfig, now: () => number = Date.now) {
    this.config = resolveConfig(config);
    this.now = now;
  }

  /** Whether the detector currently considers the scene to be moving. */
  get isMoving(): boolean {
    return this.moving;
  }

  /**
   * Feed one motion-metric sample. Returns the emitted event (or `null`) plus
   * the current moving state.
   *
   * Non-finite samples (`NaN`, `±Infinity`) are ignored: they neither change
   * state nor emit an event nor advance the stillness timer, so a glitchy CV
   * reading cannot trigger a false alert or a false stillness reset.
   *
   * A single sample can emit AT MOST one event. A `motion` rising edge always
   * takes precedence; otherwise the stillness timer may fire `no_motion`.
   */
  push(metric: MotionMetric): MotionSampleResult {
    if (!Number.isFinite(metric)) {
      return { event: null, moving: this.moving };
    }

    this.lastMetric = metric;

    const { enterThreshold, exitThreshold, cooldownMs } = this.config;
    const ts = this.now();

    // Disarm on a falling edge to/below the exit threshold; the scene is now
    // STILL, so (re)start the stillness timer if it is not already running.
    if (metric <= exitThreshold) {
      if (this.moving) {
        this.moving = false;
      }
      if (this.stillSince === null) {
        this.stillSince = ts;
        this.noMotionFired = false;
      }
    }

    // Rising edge into the moving band: candidate for a `motion` event. This
    // also cancels any pending stillness timer.
    if (!this.moving && metric >= enterThreshold) {
      this.moving = true;
      this.stillSince = null;
      this.noMotionFired = false;

      const withinCooldown =
        this.lastMotionAt !== null && ts - this.lastMotionAt < cooldownMs;

      if (!withinCooldown) {
        this.lastMotionAt = ts;
        const event: MotionEvent = {
          type: 'motion',
          timestamp: ts,
          metric,
          threshold: enterThreshold,
        };
        return { event, moving: this.moving };
      }
      // In cooldown: armed/moving, but no event emitted this sample.
      return { event: null, moving: this.moving };
    }

    // Not a fresh motion edge — evaluate the stillness timer.
    return { event: this.evaluateStillness(ts), moving: this.moving };
  }

  /**
   * Advance only the no-motion timer using the injected clock, WITHOUT a new
   * metric sample. Use when the source delivers frames irregularly (or pauses)
   * but you still want stillness to be surfaced on a steady cadence (e.g. a 1s
   * poll). Returns a `no_motion` event if the threshold has now elapsed, else
   * `null`. Never emits `motion` (no new metric to evaluate a rising edge).
   */
  tick(): MotionEvent | null {
    return this.evaluateStillness(this.now());
  }

  /**
   * Fire a single `no_motion` event if the scene has been continuously still
   * for at least `noMotionThresholdMs`. Idempotent within one still stretch.
   */
  private evaluateStillness(ts: number): MotionEvent | null {
    if (this.stillSince === null || this.noMotionFired) {
      return null;
    }
    const elapsed = ts - this.stillSince;
    if (elapsed < this.config.noMotionThresholdMs) {
      return null;
    }
    this.noMotionFired = true;
    return {
      type: 'no_motion',
      timestamp: ts,
      metric: this.lastMetric,
      threshold: this.config.enterThreshold,
    };
  }

  /**
   * Reset transient state (moving flag, cooldown clock, stillness timer).
   * Configuration is preserved. Use when (re)starting a monitoring session.
   */
  reset(): void {
    this.moving = false;
    this.lastMotionAt = null;
    this.stillSince = null;
    this.noMotionFired = false;
    this.lastMetric = null;
  }
}

/**
 * Convenience factory mirroring the project's service-style constructors.
 */
export function createMotionDetector(
  config: MotionDetectorConfig,
  now?: () => number,
): MotionDetector {
  return new MotionDetector(config, now);
}
