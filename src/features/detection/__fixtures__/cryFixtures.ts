/**
 * Deterministic fixture sample sequences for the heuristic cry detector (DMY-49).
 *
 * Each fixture is an EXPLICIT array of {@link CrySample} (`{rms, bandEnergyRatio,
 * timestamp}`) so the false-positive-rate test is fully reproducible — no random
 * generation, no audio. Samples are spaced at {@link SAMPLE_INTERVAL_MS} (a
 * realistic ~10Hz feature cadence). The `expectCry` flag is the ground truth used
 * to score detection accuracy + FP-rate against {@link DEFAULT_CRY_CONFIG}.
 *
 * The non-cry fixtures cover the explicit DMY-49 confounders:
 *  - DOOR SLAM      — a short (<5s) loud, in-band burst then silence.
 *  - WHITE NOISE    — loud but broadband, so `bandEnergyRatio` stays low.
 *  - QUIET ROOM     — low RMS throughout.
 *  - TV / SPEECH    — moderate, fluctuating, often out-of-band & not sustained.
 *  - BRIEF FUSS     — a real cry-shaped sound but <5s (settles before the rule).
 */
import { DEFAULT_CRY_CONFIG } from '../cryConfig';
import type { CrySample } from '../cryTypes';

/** Spacing between consecutive fixture samples (ms). ~10Hz feature cadence. */
export const SAMPLE_INTERVAL_MS = 100;

/** A labelled fixture: a sample sequence + whether a cry SHOULD be detected. */
export interface CryFixture {
  readonly name: string;
  readonly expectCry: boolean;
  readonly samples: readonly CrySample[];
}

/**
 * Build a sample run of `count` samples, each `(rms, bandEnergyRatio)` from the
 * generators, timestamped from `startMs` at {@link SAMPLE_INTERVAL_MS} spacing.
 */
function run(
  count: number,
  rms: (i: number) => number,
  band: (i: number) => number,
  startMs = 0,
): CrySample[] {
  const out: CrySample[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      rms: rms(i),
      bandEnergyRatio: band(i),
      timestamp: startMs + i * SAMPLE_INTERVAL_MS,
    });
  }
  return out;
}

/** A steady, sustained, in-band cry: ~7s well above both thresholds. */
const sustainedCry = run(
  70,
  () => 0.75,
  () => 0.7,
);

/** A wavering cry: loud + in-band, with small dips that never drop below. ~8s. */
const waveringCry = run(
  80,
  i => 0.6 + 0.12 * Math.abs(Math.sin(i / 4)),
  i => 0.6 + 0.08 * Math.abs(Math.cos(i / 5)),
);

/** A loud, in-band burst that lasts only ~2s (door slam reverberation). */
const doorSlam = [
  ...run(20, () => 0.85, () => 0.65, 0), // ~2s loud, in-band
  ...run(40, () => 0.05, () => 0.2, 2000), // then quiet
];

/** Loud broadband noise (fan/static): high RMS, low in-band ratio, for ~8s. */
const whiteNoise = run(
  80,
  () => 0.8,
  () => 0.3, // below bandEnergyRatioThreshold
);

/** A quiet room: low RMS throughout (~8s). */
const quietRoom = run(
  80,
  () => 0.1,
  () => 0.4,
);

/** TV / muffled speech: moderate, fluctuating, frequently out-of-band, ~9s. */
const tvChatter = run(
  90,
  i => 0.45 + 0.2 * Math.sin(i / 3),
  i => 0.4 + 0.2 * Math.cos(i / 2), // dips below band threshold often
);

/** A brief cry-shaped fuss that settles in ~3s (under the 5s rule). */
const briefFuss = [
  ...run(30, () => 0.7, () => 0.65, 0), // ~3s cry-shaped
  ...run(40, () => 0.15, () => 0.4, 3000), // then settles
];

/** A genuine cry that starts ~1.5s into mixed ambient noise, then sustains ~6s. */
const cryAfterAmbient = [
  ...run(15, () => 0.4, () => 0.35, 0), // ambient, not a candidate
  ...run(60, () => 0.72, () => 0.66, 1500), // ~6s sustained cry
];

/** Two separate cries with a clear gap (re-arm) — counts as one expectCry run. */
const twoCriesWithGap = [
  ...run(60, () => 0.75, () => 0.68, 0), // cry #1, ~6s
  ...run(30, () => 0.1, () => 0.3, 6000), // ~3s clear gap (> rearmClearMs)
  ...run(60, () => 0.75, () => 0.68, 9000), // cry #2, ~6s
];

/** The full labelled fixture set used by the FP-rate test. */
export const CRY_FIXTURES: readonly CryFixture[] = [
  { name: 'sustained-cry', expectCry: true, samples: sustainedCry },
  { name: 'wavering-cry', expectCry: true, samples: waveringCry },
  { name: 'cry-after-ambient', expectCry: true, samples: cryAfterAmbient },
  { name: 'two-cries-with-gap', expectCry: true, samples: twoCriesWithGap },
  { name: 'door-slam', expectCry: false, samples: doorSlam },
  { name: 'white-noise', expectCry: false, samples: whiteNoise },
  { name: 'quiet-room', expectCry: false, samples: quietRoom },
  { name: 'tv-chatter', expectCry: false, samples: tvChatter },
  { name: 'brief-fuss', expectCry: false, samples: briefFuss },
];

/** Re-export the config the fixtures were tuned against, for the test. */
export { DEFAULT_CRY_CONFIG };
