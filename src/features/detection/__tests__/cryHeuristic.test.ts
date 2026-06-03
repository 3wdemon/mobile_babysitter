/**
 * Unit tests for the pure heuristic cry detector (DMY-49).
 *
 * Timing is driven entirely by each sample's `timestamp` (no real clock), so the
 * >5s continuity rule + re-arm debounce are deterministic. Also runs the labelled
 * fixture set (cry / non-cry) and asserts the false-positive rate < 20% AND that
 * the true cries are detected.
 */
import {
  CRY_MIN_DURATION_MS,
  CRY_REARM_CLEAR_MS,
  DEFAULT_CRY_CONFIG,
} from '../cryConfig';
import {
  CryHeuristicDetector,
  createCryHeuristicDetector,
} from '../cryHeuristic';
import type { CryEvent, CrySample } from '../cryTypes';
import { CRY_FIXTURES, SAMPLE_INTERVAL_MS } from '../__fixtures__/cryFixtures';

const CONFIG = DEFAULT_CRY_CONFIG;

/** Feed a sequence; return every emitted event in order. */
function feed(
  detector: CryHeuristicDetector,
  samples: readonly CrySample[],
): CryEvent[] {
  const events: CryEvent[] = [];
  for (const s of samples) {
    const { event } = detector.push(s);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

/** Build N samples at fixed (rms, band) spaced SAMPLE_INTERVAL_MS from startMs. */
function steady(
  count: number,
  rms: number,
  band: number,
  startMs = 0,
): CrySample[] {
  const out: CrySample[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({ rms, bandEnergyRatio: band, timestamp: startMs + i * SAMPLE_INTERVAL_MS });
  }
  return out;
}

describe('CryHeuristicDetector', () => {
  it('fires ONE cry when both features stay above threshold for >5s', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    // 70 samples * 100ms = ~7s of sustained, in-band loudness.
    const events = feed(detector, steady(70, 0.75, 0.7));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'cry', rms: 0.75, bandEnergyRatio: 0.7 });
    expect(events[0].confidence).toBeGreaterThan(0);
    expect(events[0].confidence).toBeLessThanOrEqual(1);
  });

  it('does not spam: a long sustained cry yields exactly one event', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    // 200 samples = 20s sustained — still ONE event (no per-sample spam).
    const events = feed(detector, steady(200, 0.8, 0.7));
    expect(events).toHaveLength(1);
  });

  it('fires exactly when the 5s boundary is crossed, not before', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    // Samples at t=0..4900ms (50 samples) are all candidates but < 5s elapsed.
    const before = feed(detector, steady(50, 0.75, 0.7)); // last ts = 4900
    expect(before).toHaveLength(0);
    // One more sample at t=5000ms crosses the boundary.
    const { event } = detector.push({ rms: 0.75, bandEnergyRatio: 0.7, timestamp: 5000 });
    expect(event?.type).toBe('cry');
    expect(event?.timestamp).toBe(5000);
  });

  it('does NOT fire for a short (<5s) loud in-band burst (door slam)', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    // 2s loud burst, then it stops.
    const events = feed(detector, [
      ...steady(20, 0.85, 0.65, 0),
      ...steady(20, 0.05, 0.2, 2000),
    ]);
    expect(events).toHaveLength(0);
  });

  it('does NOT fire for loud broadband noise (low band-ratio) — white noise', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    // 10s loud but out-of-band: never a candidate.
    const events = feed(detector, steady(100, 0.9, 0.3));
    expect(events).toHaveLength(0);
  });

  it('does NOT fire for high RMS but sub-threshold band ratio (out-of-band)', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    // Band ratio exactly at threshold-minus-epsilon for a long time.
    const events = feed(
      detector,
      steady(120, 0.95, CONFIG.bandEnergyRatioThreshold - 0.01),
    );
    expect(events).toHaveLength(0);
  });

  it('does NOT fire for in-band sound that is too quiet (sub-RMS)', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    const events = feed(
      detector,
      steady(120, CONFIG.rmsThreshold - 0.01, 0.9),
    );
    expect(events).toHaveLength(0);
  });

  it('resets continuity on a brief out-of-band dip (no premature fire)', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    const events = feed(detector, [
      ...steady(40, 0.75, 0.7, 0), // 4s candidate
      { rms: 0.75, bandEnergyRatio: 0.3, timestamp: 4000 }, // dip breaks it
      ...steady(40, 0.75, 0.7, 4100), // only 4s again -> no fire
    ]);
    expect(events).toHaveLength(0);
  });

  it('re-arms after a clear gap and fires again for a NEW episode', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    const events = feed(detector, [
      ...steady(60, 0.75, 0.7, 0), // cry #1 (~6s) -> fires
      ...steady(30, 0.1, 0.3, 6000), // 3s clear gap (> rearmClearMs) -> re-arm
      ...steady(60, 0.75, 0.7, 9000), // cry #2 (~6s) -> fires
    ]);
    expect(events).toHaveLength(2);
    expect(events[0].timestamp).toBeLessThan(events[1].timestamp);
  });

  it('does NOT re-fire if the clear gap is shorter than rearmClearMs', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    // Clear for only 500ms (< 1500ms rearmClearMs) then loud again, sustained.
    const events = feed(detector, [
      ...steady(60, 0.75, 0.7, 0), // cry #1 fires
      ...steady(5, 0.1, 0.3, 6000), // 500ms clear — too short to re-arm
      ...steady(80, 0.75, 0.7, 6500), // sustained again, but latch still held
    ]);
    expect(events).toHaveLength(1);
  });

  it('ignores non-finite features without changing state', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    const events = feed(detector, [
      ...steady(40, 0.75, 0.7, 0),
      { rms: NaN, bandEnergyRatio: 0.7, timestamp: 4000 }, // ignored
      { rms: 0.75, bandEnergyRatio: Infinity, timestamp: 4100 }, // ignored
      ...steady(20, 0.75, 0.7, 4000), // continuity preserved -> crosses 5s
    ]);
    expect(events).toHaveLength(1);
  });

  it('falls back to the injected clock when a timestamp is not finite', () => {
    let t = 0;
    const detector = createCryHeuristicDetector(CONFIG, () => t);
    const events: CryEvent[] = [];
    for (let i = 0; i < 70; i += 1) {
      t = i * 100;
      const { event } = detector.push({
        rms: 0.75,
        bandEnergyRatio: 0.7,
        timestamp: NaN, // force clock fallback
      });
      if (event) {
        events.push(event);
      }
    }
    expect(events).toHaveLength(1);
  });

  it('reset() clears the latch and continuity', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    feed(detector, steady(70, 0.75, 0.7));
    detector.reset();
    expect(detector.isCandidate).toBe(false);
    const events = feed(detector, steady(70, 0.75, 0.7));
    expect(events).toHaveLength(1);
  });

  it('exposes isCandidate while a cry-shaped stretch is building', () => {
    const detector = createCryHeuristicDetector(CONFIG);
    detector.push({ rms: 0.75, bandEnergyRatio: 0.7, timestamp: 0 });
    expect(detector.isCandidate).toBe(true);
    detector.push({ rms: 0.1, bandEnergyRatio: 0.3, timestamp: 100 });
    expect(detector.isCandidate).toBe(false);
  });

  it('rejects an invalid config', () => {
    expect(() =>
      createCryHeuristicDetector({ rmsThreshold: NaN, bandEnergyRatioThreshold: 0.5 }),
    ).toThrow(/rmsThreshold/);
    expect(() =>
      createCryHeuristicDetector({ rmsThreshold: 0.5, bandEnergyRatioThreshold: NaN }),
    ).toThrow(/bandEnergyRatioThreshold/);
    expect(() =>
      createCryHeuristicDetector({
        rmsThreshold: 0.5,
        bandEnergyRatioThreshold: 0.5,
        minDurationMs: 0,
      }),
    ).toThrow(/minDurationMs/);
    expect(() =>
      createCryHeuristicDetector({
        rmsThreshold: 0.5,
        bandEnergyRatioThreshold: 0.5,
        rearmClearMs: -1,
      }),
    ).toThrow(/rearmClearMs/);
  });

  it('default constants match the documented DMY-49 rule', () => {
    expect(CRY_MIN_DURATION_MS).toBe(5000);
    expect(CRY_REARM_CLEAR_MS).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CRY_CONFIG.minDurationMs).toBe(CRY_MIN_DURATION_MS);
  });

  describe('fixture set: false-positive rate < 20% AND true cries detected', () => {
    it('scores the labelled fixtures within tolerance', () => {
      const cryFixtures = CRY_FIXTURES.filter(f => f.expectCry);
      const nonCryFixtures = CRY_FIXTURES.filter(f => !f.expectCry);

      // Sanity: we have a meaningful set on both sides.
      expect(cryFixtures.length).toBeGreaterThanOrEqual(3);
      expect(nonCryFixtures.length).toBeGreaterThanOrEqual(4);

      let falsePositives = 0;
      let truePositives = 0;

      for (const fx of CRY_FIXTURES) {
        const detector = createCryHeuristicDetector(DEFAULT_CRY_CONFIG);
        const fired = feed(detector, fx.samples).length > 0;
        if (fx.expectCry) {
          // Every true cry MUST be detected (no missed cries on the set).
          expect(fired).toBe(true);
          if (fired) {
            truePositives += 1;
          }
        } else if (fired) {
          falsePositives += 1;
        }
      }

      const fpRate = falsePositives / nonCryFixtures.length;
      // Surface the measured rate in the test output.
      console.log(
        `cry fixtures: ${cryFixtures.length} cry / ${nonCryFixtures.length} non-cry; ` +
          `true-positives=${truePositives}/${cryFixtures.length}; ` +
          `false-positives=${falsePositives}/${nonCryFixtures.length}; ` +
          `FP-rate=${(fpRate * 100).toFixed(1)}%`,
      );

      expect(truePositives).toBe(cryFixtures.length);
      expect(fpRate).toBeLessThan(0.2);
    });
  });
});
