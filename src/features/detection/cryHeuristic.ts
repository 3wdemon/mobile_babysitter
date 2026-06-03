/**
 * cryHeuristic — pure, framework-free HEURISTIC cry-detection core (DMY-49).
 *
 * A $0, no-ML stop-gap for DMY-21 (the TFLite cry model, blocked-external). Feed
 * it {@link CrySample}s one at a time and it decides whether a "probable cry"
 * episode has occurred, emitting ONE {@link CryEvent} per episode. It has no
 * React, no real timers, no I/O and no audio dependency — the `rms` and
 * `bandEnergyRatio` numbers come from an abstract source (audio DSP —
 * DMY-18/DMY-9). Time is taken from each sample's `timestamp`; an INJECTED
 * `now()` clock is only a fallback when a sample's timestamp is missing/!finite,
 * so all timing is deterministic and testable.
 *
 * Heuristic (the DMY-49 acceptance rule):
 *   A sample is a CANDIDATE when BOTH `rms >= rmsThreshold` AND
 *   `bandEnergyRatio >= bandEnergyRatioThreshold`. When candidates hold
 *   CONTINUOUSLY for at least `minDurationMs` (default 5000 — the ">5s
 *   continuous noise" rule), the detector fires ONE cry for that episode.
 *
 * Why this rejects the obvious false positives:
 *  - **door slam** (short loud burst): loud but < 5s, so the duration gate never
 *    elapses — no event.
 *  - **white / broadband noise** (fan, static): may be loud but its energy is
 *    spread across the spectrum, so `bandEnergyRatio` stays below threshold —
 *    never a candidate, no event.
 *  - The 250-2000Hz band that defines `bandEnergyRatio` is computed UPSTREAM by
 *    the source; this module consumes the ratio (see `cryConfig.ts`).
 *
 * Design (anti-spam):
 *  - **Hysteresis / once-per-episode**: once an episode fires, the detector is
 *    LATCHED and will not fire again for the same sustained cry. It re-arms only
 *    after the candidate condition stays CLEARED (either feature below its
 *    threshold) continuously for `rearmClearMs` — debouncing brief dips so a
 *    wavering cry is ONE episode, not many. A genuinely new cry after the clear
 *    gap fires again.
 *  - **No per-sample spam**: a sustained cry yields exactly one event regardless
 *    of how many samples arrive during it.
 *  - **Edge cases**: a sample with a non-finite `rms` or `bandEnergyRatio` is
 *    ignored entirely (no state change, no event, continuity untouched), so a
 *    glitchy meter reading can neither trigger nor reset an episode. A sample
 *    whose `timestamp` is missing/!finite falls back to the injected `now()`.
 *
 * Privacy: emitted events contain only the two features, a coarse confidence and
 * a timestamp — never any audio.
 */
import { CRY_MIN_DURATION_MS, CRY_REARM_CLEAR_MS } from './cryConfig';
import type {
  CryEvent,
  CryHeuristicConfig,
  CrySample,
  CrySampleResult,
} from './cryTypes';

/** Resolved config with defaults applied and invariants enforced. */
interface ResolvedConfig {
  readonly rmsThreshold: number;
  readonly bandEnergyRatioThreshold: number;
  readonly minDurationMs: number;
  readonly rearmClearMs: number;
}

function resolveConfig(config: CryHeuristicConfig): ResolvedConfig {
  const { rmsThreshold, bandEnergyRatioThreshold } = config;
  if (!Number.isFinite(rmsThreshold)) {
    throw new Error(
      `cryHeuristic: rmsThreshold must be a finite number, got ${rmsThreshold}`,
    );
  }
  if (!Number.isFinite(bandEnergyRatioThreshold)) {
    throw new Error(
      `cryHeuristic: bandEnergyRatioThreshold must be a finite number, got ${bandEnergyRatioThreshold}`,
    );
  }

  const minDurationMs = config.minDurationMs ?? CRY_MIN_DURATION_MS;
  if (!Number.isFinite(minDurationMs) || minDurationMs <= 0) {
    throw new Error(
      `cryHeuristic: minDurationMs must be a finite number > 0, got ${minDurationMs}`,
    );
  }

  const rearmClearMs = config.rearmClearMs ?? CRY_REARM_CLEAR_MS;
  if (!Number.isFinite(rearmClearMs) || rearmClearMs < 0) {
    throw new Error(
      `cryHeuristic: rearmClearMs must be a finite number >= 0, got ${rearmClearMs}`,
    );
  }

  return {
    rmsThreshold,
    bandEnergyRatioThreshold,
    minDurationMs,
    rearmClearMs,
  };
}

/**
 * Coarse 0..1 confidence: how far the completed sample sat above BOTH thresholds.
 * Purely a heuristic ranking hint (NOT a probability); a future ML model
 * (DMY-21) reports a real probability on the same field. Averages the two
 * normalised over-shoots so being well above both reads higher than scraping by.
 */
function computeConfidence(
  rms: number,
  bandEnergyRatio: number,
  cfg: ResolvedConfig,
): number {
  const rmsOver = clamp01(
    (rms - cfg.rmsThreshold) / Math.max(1 - cfg.rmsThreshold, 1e-6),
  );
  const bandOver = clamp01(
    (bandEnergyRatio - cfg.bandEnergyRatioThreshold) /
      Math.max(1 - cfg.bandEnergyRatioThreshold, 1e-6),
  );
  return clamp01((rmsOver + bandOver) / 2);
}

function clamp01(v: number): number {
  if (v < 0) {
    return 0;
  }
  if (v > 1) {
    return 1;
  }
  return v;
}

/**
 * A stateful heuristic cry detector. Create one per monitoring session and feed
 * it samples via {@link CryHeuristicDetector.push}.
 */
export class CryHeuristicDetector {
  private readonly config: ResolvedConfig;

  /** Fallback clock when a sample omits a finite `timestamp`. */
  private readonly now: () => number;

  /**
   * Timestamp at which the CURRENT continuous candidate stretch began, or `null`
   * when not currently in a candidate stretch.
   */
  private candidateSince: number | null = null;

  /**
   * `true` once the current episode has fired; stays latched until the condition
   * has been continuously cleared for `rearmClearMs` (re-arm). Prevents
   * per-sample / per-episode spam.
   */
  private fired = false;

  /**
   * Timestamp at which the candidate condition most recently CLEARED, or `null`
   * when currently a candidate (or before the first sample). Used to time the
   * `rearmClearMs` re-arm debounce.
   */
  private clearedSince: number | null = null;

  constructor(config: CryHeuristicConfig, now: () => number = Date.now) {
    this.config = resolveConfig(config);
    this.now = now;
  }

  /**
   * Whether a candidate (both-features-above-threshold) stretch is currently in
   * progress. Useful for a live UI; not part of the firing decision directly.
   */
  get isCandidate(): boolean {
    return this.candidateSince !== null;
  }

  /**
   * Feed one sample. Returns the emitted event (or `null`) plus whether a
   * candidate stretch is currently held.
   *
   * Non-finite features (`NaN`, `±Infinity`) are ignored: they neither change
   * state nor emit an event nor touch continuity, so a glitchy meter reading
   * cannot trigger a false cry or reset a genuine one.
   */
  push(sample: CrySample): CrySampleResult {
    const { rms, bandEnergyRatio } = sample;
    if (!Number.isFinite(rms) || !Number.isFinite(bandEnergyRatio)) {
      return { event: null, candidate: this.candidateSince !== null };
    }

    const ts = Number.isFinite(sample.timestamp)
      ? sample.timestamp
      : this.now();

    const { rmsThreshold, bandEnergyRatioThreshold, minDurationMs, rearmClearMs } =
      this.config;
    const isCandidate =
      rms >= rmsThreshold && bandEnergyRatio >= bandEnergyRatioThreshold;

    if (isCandidate) {
      // Candidate sample: clear any "cleared" debounce and (re)start / continue
      // the continuous candidate stretch.
      this.clearedSince = null;
      if (this.candidateSince === null) {
        this.candidateSince = ts;
      }

      // Sustained long enough AND not already fired for this episode -> emit one.
      const elapsed = ts - this.candidateSince;
      if (!this.fired && elapsed >= minDurationMs) {
        this.fired = true;
        const event: CryEvent = {
          type: 'cry',
          timestamp: ts,
          confidence: computeConfidence(rms, bandEnergyRatio, this.config),
          rms,
          bandEnergyRatio,
        };
        return { event, candidate: true };
      }

      return { event: null, candidate: true };
    }

    // Not a candidate: the continuous stretch (if any) is broken.
    this.candidateSince = null;

    // Time the re-arm debounce. Once the condition has been continuously cleared
    // for `rearmClearMs`, drop the latch so a genuinely new cry can fire again.
    if (this.fired) {
      if (this.clearedSince === null) {
        this.clearedSince = ts;
      } else if (ts - this.clearedSince >= rearmClearMs) {
        this.fired = false;
        this.clearedSince = null;
      }
    }

    return { event: null, candidate: false };
  }

  /**
   * Reset transient state (candidate stretch, fired latch, re-arm clock).
   * Configuration is preserved. Use when (re)starting a monitoring session.
   */
  reset(): void {
    this.candidateSince = null;
    this.fired = false;
    this.clearedSince = null;
  }
}

/** Convenience factory mirroring the other detection feature factories. */
export function createCryHeuristicDetector(
  config: CryHeuristicConfig,
  now?: () => number,
): CryHeuristicDetector {
  return new CryHeuristicDetector(config, now);
}
