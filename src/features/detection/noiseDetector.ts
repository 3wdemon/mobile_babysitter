/**
 * noiseDetector — pure noise-threshold detection core (DMY-8).
 *
 * Stateful but framework-free: feed it loudness samples one at a time and it
 * decides whether each crosses the threshold into a {@link NoiseEvent}. It has
 * no React, no timers, no I/O and no audio dependency — the loudness numbers
 * come from an abstract source (real microphone/WebRTC arrives in DMY-18).
 *
 * Design (anti-spam):
 *  - **Hysteresis**: a rising edge above `enterThreshold` arms the detector and
 *    fires an event; the detector only disarms once the level drops to/below
 *    `exitThreshold`. A sustained loud stretch therefore yields ONE event, not
 *    one-per-sample, and re-firing needs a genuine new rising edge.
 *  - **Cooldown**: even across separate rising edges, two emitted events are at
 *    least `cooldownMs` apart, rate-limiting bursts of brief loud spikes.
 *  - **Edge cases**: `NaN`/`±Infinity`/non-finite samples are ignored (no event,
 *    no state change). Negative or extreme finite values are treated as ordinary
 *    levels (e.g. dBFS is negative), compared against the configured thresholds.
 *
 * Privacy: emitted events contain only the loudness metric, threshold and a
 * timestamp — never any audio.
 */
import type {
  NoiseDetectorConfig,
  NoiseEvent,
  NoiseLevel,
  NoiseSampleResult,
} from './types';

/**
 * Resolved config with defaults applied and invariants enforced.
 */
interface ResolvedConfig {
  readonly enterThreshold: number;
  readonly exitThreshold: number;
  readonly cooldownMs: number;
}

function resolveConfig(config: NoiseDetectorConfig): ResolvedConfig {
  const { enterThreshold } = config;
  if (!Number.isFinite(enterThreshold)) {
    throw new Error(
      `noiseDetector: enterThreshold must be a finite number, got ${enterThreshold}`,
    );
  }

  const exitThreshold = config.exitThreshold ?? enterThreshold;
  if (!Number.isFinite(exitThreshold)) {
    throw new Error(
      `noiseDetector: exitThreshold must be a finite number, got ${exitThreshold}`,
    );
  }
  if (exitThreshold > enterThreshold) {
    throw new Error(
      `noiseDetector: exitThreshold (${exitThreshold}) must be <= enterThreshold (${enterThreshold})`,
    );
  }

  const cooldownMs = config.cooldownMs ?? 0;
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new Error(
      `noiseDetector: cooldownMs must be a finite number >= 0, got ${cooldownMs}`,
    );
  }

  return { enterThreshold, exitThreshold, cooldownMs };
}

/**
 * A stateful noise detector. Create one per monitoring session and feed it
 * samples via {@link NoiseDetector.push}.
 */
export class NoiseDetector {
  private readonly config: ResolvedConfig;

  /**
   * Optional clock injection for deterministic cooldown tests. Defaults to
   * `Date.now`. Kept private so the public surface stays time-source-agnostic.
   */
  private readonly now: () => number;

  /** Whether the level is currently in the loud band (hysteresis state). */
  private armed = false;

  /** Timestamp of the last emitted event, or `null` if none yet. */
  private lastEventAt: number | null = null;

  constructor(config: NoiseDetectorConfig, now: () => number = Date.now) {
    this.config = resolveConfig(config);
    this.now = now;
  }

  /** Whether the detector is currently armed (level in the loud band). */
  get isArmed(): boolean {
    return this.armed;
  }

  /**
   * Feed one loudness sample. Returns the emitted event (or `null`) plus the
   * current armed state.
   *
   * Non-finite samples (`NaN`, `±Infinity`) are ignored: they neither change
   * state nor emit an event, so a glitchy meter reading cannot trigger a false
   * alert.
   */
  push(level: NoiseLevel): NoiseSampleResult {
    if (!Number.isFinite(level)) {
      return { event: null, armed: this.armed };
    }

    const { enterThreshold, exitThreshold, cooldownMs } = this.config;

    // Disarm on a falling edge so a fresh rising edge can fire again.
    if (this.armed && level <= exitThreshold) {
      this.armed = false;
    }

    // Rising edge into the loud band: candidate for an event.
    if (!this.armed && level >= enterThreshold) {
      this.armed = true;

      const ts = this.now();
      const withinCooldown =
        this.lastEventAt !== null && ts - this.lastEventAt < cooldownMs;

      if (!withinCooldown) {
        this.lastEventAt = ts;
        const event: NoiseEvent = {
          type: 'noise',
          timestamp: ts,
          level,
          threshold: enterThreshold,
        };
        return { event, armed: this.armed };
      }
    }

    return { event: null, armed: this.armed };
  }

  /**
   * Reset transient state (armed flag + cooldown clock). Configuration is
   * preserved. Use when (re)starting a monitoring session.
   */
  reset(): void {
    this.armed = false;
    this.lastEventAt = null;
  }
}

/**
 * Convenience factory mirroring the project's service-style constructors.
 */
export function createNoiseDetector(
  config: NoiseDetectorConfig,
  now?: () => number,
): NoiseDetector {
  return new NoiseDetector(config, now);
}
