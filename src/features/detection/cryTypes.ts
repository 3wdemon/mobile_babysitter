/**
 * Types for HEURISTIC cry detection on the baby-unit (DMY-49).
 *
 * A $0, no-ML stop-gap for DMY-21 (the TFLite cry model, blocked-external): it
 * flags a "probable cry" from two cheap audio features per sample —
 *  - `rms`            — short-window loudness (the same normalised 0..1 scale the
 *    DMY-8 noise detector consumes), and
 *  - `bandEnergyRatio` — the FRACTION of the frame's energy that falls inside the
 *    250-2000Hz band (where an infant cry's fundamental + first formants sit),
 *    on a 0..1 scale.
 *
 * The 250-2000Hz band-pass and the FFT/energy maths that produce
 * `bandEnergyRatio` are computed UPSTREAM by the source (real DSP arrives with
 * the audio capture work — DMY-18/DMY-9). This module consumes the pre-computed
 * ratio: it does NOT touch raw audio, the microphone, or WebRTC tracks. When the
 * ML model (DMY-21) lands it will REPLACE or AUGMENT this heuristic, emitting the
 * same `'cry'` {@link AlertType} downstream so nothing else has to change.
 *
 * Privacy: a {@link CryEvent} carries ONLY a confidence-ish ratio, the trigger
 * features and a timestamp — never any audio buffer or anything from which sound
 * could be reconstructed. Nothing is stored or logged beyond those scalars.
 */

/**
 * One audio-feature reading fed into the heuristic cry detector.
 *
 * Both features are unitless 0..1 scalars (the detector is agnostic to the exact
 * scale; thresholds are configured in the same units). This is intentionally NOT
 * audio data — the source has already reduced a frame to these two numbers.
 */
export interface CrySample {
  /**
   * Short-window loudness (e.g. linear RMS 0..1), same scale as the DMY-8 noise
   * detector. A cry is, first of all, sustained loudness.
   */
  readonly rms: number;
  /**
   * Fraction (0..1) of the frame's energy inside the 250-2000Hz cry band,
   * computed UPSTREAM by the source. A high value means the loudness is
   * concentrated where a cry lives (vs. broadband white noise or a low-frequency
   * door slam, which spread energy outside the band).
   */
  readonly bandEnergyRatio: number;
  /**
   * Epoch milliseconds for this sample. The detector times the >5s continuity
   * rule from these sample timestamps (see {@link CryHeuristicDetector}); the
   * injected `now()` clock is only a fallback when a sample omits/!finite-`ts`.
   */
  readonly timestamp: number;
}

/**
 * An emitted "probable cry" event. Privacy-first: the features that crossed the
 * heuristic + a coarse confidence + when it happened — never any audio.
 */
export interface CryEvent {
  /** Discriminant so detection kinds (noise/motion/cry) can share an event bus. */
  readonly type: 'cry';
  /** Epoch ms at which the sustained-cry condition was first satisfied. */
  readonly timestamp: number;
  /**
   * Coarse 0..1 confidence for the heuristic (NOT a probability). Derived from
   * how far the sustained features sat above their thresholds; lets the UI/log
   * rank events and lets a future ML model (DMY-21) report on the same field.
   */
  readonly confidence: number;
  /** The RMS on the sample that completed the episode, for UI/log context. */
  readonly rms: number;
  /** The band-energy ratio on that sample, for UI/log context. */
  readonly bandEnergyRatio: number;
}

/**
 * Heuristic cry-detector configuration.
 *
 * The detector flags a cry when BOTH features stay above their thresholds
 * CONTINUOUSLY for at least `minDurationMs`. Hysteresis stops a single episode
 * from re-firing and a debounce gap re-arms it for the next one:
 *
 *  - `rmsThreshold` — loudness at/above which a sample counts as "loud enough".
 *  - `bandEnergyRatioThreshold` — fraction of energy in the 250-2000Hz cry band
 *    at/above which the sound is "cry-shaped" (rejects broadband noise + low-
 *    frequency thuds that are loud but out-of-band).
 *  - `minDurationMs` — how long BOTH conditions must hold continuously before one
 *    cry fires. Default 5000ms (the DMY-49 ">5s continuous noise" rule).
 *  - `rearmClearMs` — how long the condition must STAY cleared (either feature
 *    below threshold) before a new episode may fire again. Debounces brief dips
 *    so a wavering cry is still treated as ONE episode, not many.
 */
export interface CryHeuristicConfig {
  /** Loudness at/above which a sample is "loud enough" to be part of a cry. */
  readonly rmsThreshold: number;
  /** Band-energy fraction at/above which the sound is "cry-shaped". */
  readonly bandEnergyRatioThreshold: number;
  /**
   * Continuous duration (ms) both conditions must hold before one cry fires.
   * Defaults to {@link CRY_MIN_DURATION_MS} (5000). Must be `> 0`.
   */
  readonly minDurationMs?: number;
  /**
   * Continuous CLEAR duration (ms) required to re-arm for a new episode.
   * Defaults to {@link CRY_REARM_CLEAR_MS}. Must be `>= 0`.
   */
  readonly rearmClearMs?: number;
}

/** Result of feeding one sample into the detector. */
export interface CrySampleResult {
  /** The cry event emitted by this sample, or `null` if none. */
  readonly event: CryEvent | null;
  /**
   * Whether the candidate (both-features-above-threshold) condition is CURRENTLY
   * held — i.e. an episode is building up or in progress. Useful for a live UI.
   */
  readonly candidate: boolean;
}

/**
 * Integration point for the real cry-feature source (audio capture/DSP —
 * DMY-18/DMY-9; later the TFLite model — DMY-21).
 *
 * A source pushes {@link CrySample}s to the supplied `onSample` callback and
 * returns an unsubscribe function. The detector / hook is agnostic to where the
 * numbers come from — a native RMS + band-pass FFT tap, a WebRTC audio meter, or
 * a test stub all satisfy this contract. No audio buffers cross this boundary,
 * only the two scalar features + a timestamp.
 */
export type CrySampleSource = (
  onSample: (sample: CrySample) => void,
) => () => void;

/**
 * A no-op {@link CrySampleSource}: subscribes nothing and emits no samples.
 * The SHIPPED default until a real feature source (DMY-18/DMY-9) is wired, so
 * the hook is safe to mount before any audio DSP exists.
 */
export const noopCrySampleSource: CrySampleSource = () => () => {};
