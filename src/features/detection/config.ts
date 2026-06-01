/**
 * Default noise-detection tuning (DMY-8).
 *
 * Levels are expressed on a normalised 0..1 loudness scale (e.g. linear RMS),
 * which the abstract source (DMY-18) is expected to provide. The concrete
 * source can map its native units (e.g. dBFS) onto this range, or callers can
 * override the whole config.
 *
 *  - `enterThreshold` 0.6 — fires once a sustained-ish loud sound is reached.
 *  - `exitThreshold`  0.4 — hysteresis gap so noise hovering near the trigger
 *    does not chatter on/off and re-fire.
 *  - `cooldownMs` 3000 — at most one noise event per 3s, so a burst of spikes
 *    does not spam alerts.
 *
 * These are conservative defaults; the user-facing sensitivity maps onto
 * `enterThreshold` via the store (`settings.noiseThreshold`).
 */
import type { NoiseDetectorConfig } from './types';

export const DEFAULT_NOISE_CONFIG: Required<NoiseDetectorConfig> = {
  enterThreshold: 0.6,
  exitThreshold: 0.4,
  cooldownMs: 3000,
};
