/**
 * Default heuristic cry-detection tuning (DMY-49).
 *
 * A $0, no-ML stop-gap for DMY-21. Features are on a normalised 0..1 scale that
 * the abstract source (audio DSP — DMY-18/DMY-9) is expected to provide; callers
 * can override the whole config. These are intentionally CODE defaults (not a
 * persisted user setting) to avoid scope creep — see DMY-49.
 *
 *  - `rmsThreshold` 0.5 — a cry is sustained loudness; 0.5 sits a touch below the
 *    DMY-8 noise enter-threshold (0.6) because here the band-ratio gate does the
 *    extra discrimination, so RMS alone need not be as high.
 *  - `bandEnergyRatioThreshold` 0.55 — at least ~55% of the frame's energy must
 *    fall in the 250-2000Hz cry band. White noise (broadband) and low-frequency
 *    thuds (door slam) spread energy outside the band and fall below this.
 *  - `minDurationMs` 5000 — BOTH conditions must hold continuously for >5s before
 *    one cry fires (the DMY-49 acceptance rule). A sub-5s burst never fires.
 *  - `rearmClearMs` 1500 — the condition must stay cleared ~1.5s before a new
 *    episode can fire, so a wavering cry counts as ONE episode, not many.
 *
 * The 250-2000Hz band itself is computed UPSTREAM (the source reduces a frame to
 * `bandEnergyRatio`); this module only consumes the ratio. Documented here as the
 * assumption the thresholds were tuned against.
 */
import type { CryHeuristicConfig } from './cryTypes';

/** Lower edge (Hz) of the cry band the `bandEnergyRatio` is computed over. */
export const CRY_BAND_LOW_HZ = 250;

/** Upper edge (Hz) of the cry band the `bandEnergyRatio` is computed over. */
export const CRY_BAND_HIGH_HZ = 2000;

/**
 * Continuous duration (ms) both features must hold above threshold before one
 * cry fires. 5000ms per the DMY-49 acceptance criteria (">5s continuous noise").
 */
export const CRY_MIN_DURATION_MS = 5000;

/**
 * Continuous CLEAR duration (ms) required to re-arm for a new episode. Debounces
 * brief dips so a single wavering cry is one episode, not a stream of events.
 */
export const CRY_REARM_CLEAR_MS = 1500;

export const DEFAULT_CRY_CONFIG: Required<CryHeuristicConfig> = {
  rmsThreshold: 0.5,
  bandEnergyRatioThreshold: 0.55,
  minDurationMs: CRY_MIN_DURATION_MS,
  rearmClearMs: CRY_REARM_CLEAR_MS,
};
