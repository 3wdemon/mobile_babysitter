/**
 * Types for noise-threshold detection on the baby-unit (DMY-8).
 *
 * The detector operates on a stream of numeric loudness samples (an abstract
 * "audio level" — e.g. RMS or dBFS). It does NOT touch raw audio, microphone
 * APIs or WebRTC tracks: the real capture source lands in DMY-18 and plugs into
 * the {@link NoiseLevelSource} integration point below.
 *
 * Privacy: a {@link NoiseEvent} carries ONLY a loudness metric and a timestamp.
 * No audio buffer, no recording, nothing that could reconstruct sound is ever
 * stored or emitted.
 */

/**
 * A single loudness reading fed into the detector.
 *
 * `level` is a unitless loudness scalar (the detector is agnostic to the exact
 * scale — RMS 0..1, dBFS negative-to-0, etc.; thresholds are configured in the
 * same units). It is intentionally NOT audio data.
 */
export type NoiseLevel = number;

/**
 * An emitted noise event. Privacy-first: contains only the metric that crossed
 * the threshold plus when it happened — never any audio.
 */
export interface NoiseEvent {
  /** Discriminant so multiple detection kinds (cry/motion) can share a bus. */
  readonly type: 'noise';
  /** Epoch milliseconds at which the threshold was crossed. */
  readonly timestamp: number;
  /** The loudness level that triggered the event (same units as the config). */
  readonly level: NoiseLevel;
  /** The enter-threshold that was exceeded, for context in the UI/log. */
  readonly threshold: NoiseLevel;
}

/**
 * Detector configuration.
 *
 * Hysteresis and cooldown exist to avoid event spam around the threshold and to
 * rate-limit how often events fire:
 *  - `enterThreshold` — level at/above which we ARM and (subject to cooldown)
 *    emit a noise event.
 *  - `exitThreshold` — level at/below which we DISARM, so a sustained loud
 *    stretch does not re-fire on every sample; a new event needs a fresh
 *    rising edge back above `enterThreshold`. Must be `<= enterThreshold`.
 *  - `cooldownMs` — minimum time between two emitted events, even across
 *    separate rising edges. `0` disables the cooldown.
 */
export interface NoiseDetectorConfig {
  /** Level at/above which a noise event is (re)armed and may fire. */
  readonly enterThreshold: NoiseLevel;
  /**
   * Level at/below which the detector disarms (hysteresis lower bound).
   * Defaults to `enterThreshold` (degenerate hysteresis) when omitted.
   */
  readonly exitThreshold?: NoiseLevel;
  /** Minimum ms between emitted events. Defaults to `0` (no cooldown). */
  readonly cooldownMs?: number;
}

/**
 * Result of feeding one sample into the detector.
 */
export interface NoiseSampleResult {
  /** The event emitted by this sample, or `null` if none. */
  readonly event: NoiseEvent | null;
  /** Whether the detector is currently armed (level is in the loud band). */
  readonly armed: boolean;
}

/**
 * Integration point for the real audio source (DMY-18).
 *
 * A source pushes loudness samples to the supplied `onLevel` callback and
 * returns an unsubscribe function. The detector / hook is agnostic to where the
 * numbers come from — a WebRTC audio-level meter, a native RMS tap, or a test
 * stub all satisfy this contract. No audio buffers cross this boundary, only
 * scalar levels.
 */
export type NoiseLevelSource = (
  onLevel: (level: NoiseLevel) => void,
) => () => void;
