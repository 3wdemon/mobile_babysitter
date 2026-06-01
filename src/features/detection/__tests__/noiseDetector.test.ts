/**
 * Unit tests for the pure noise-detection core (DMY-8).
 *
 * Covers: above/below threshold, hysteresis (no re-fire while staying loud,
 * re-fire only on a fresh rising edge), cooldown rate-limiting, config
 * validation, edge cases (NaN/±Infinity/negative/extreme) and the privacy
 * guarantee that events carry no audio data.
 */
import { createNoiseDetector, NoiseDetector } from '../noiseDetector';

describe('NoiseDetector', () => {
  describe('threshold', () => {
    it('emits a noise event when the level reaches the enter threshold', () => {
      const d = new NoiseDetector({ enterThreshold: 0.6 });
      const { event, armed } = d.push(0.7);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('noise');
      expect(event?.level).toBe(0.7);
      expect(event?.threshold).toBe(0.6);
      expect(armed).toBe(true);
    });

    it('does not emit below the threshold', () => {
      const d = new NoiseDetector({ enterThreshold: 0.6 });
      expect(d.push(0.1).event).toBeNull();
      expect(d.push(0.59).event).toBeNull();
      expect(d.isArmed).toBe(false);
    });

    it('treats the enter threshold as inclusive (>=)', () => {
      const d = new NoiseDetector({ enterThreshold: 0.6 });
      expect(d.push(0.6).event).not.toBeNull();
    });

    it('stamps the event with the injected clock', () => {
      const d = new NoiseDetector({ enterThreshold: 0.5 }, () => 1234);
      expect(d.push(0.9).event?.timestamp).toBe(1234);
    });
  });

  describe('hysteresis', () => {
    it('does not re-fire while the level stays in the loud band', () => {
      const d = new NoiseDetector({ enterThreshold: 0.6, exitThreshold: 0.4 });
      expect(d.push(0.7).event).not.toBeNull(); // rising edge -> fire
      expect(d.push(0.8).event).toBeNull(); // still loud -> no spam
      expect(d.push(0.65).event).toBeNull();
      expect(d.push(0.5).event).toBeNull(); // between exit and enter, still armed
      expect(d.isArmed).toBe(true);
    });

    it('re-fires only after a falling edge below the exit threshold and a new rise', () => {
      const d = new NoiseDetector({ enterThreshold: 0.6, exitThreshold: 0.4 });
      expect(d.push(0.7).event).not.toBeNull();
      expect(d.push(0.3).event).toBeNull(); // falling edge -> disarm
      expect(d.isArmed).toBe(false);
      expect(d.push(0.7).event).not.toBeNull(); // fresh rising edge -> fire again
    });

    it('does not disarm in the hysteresis gap (between exit and enter)', () => {
      const d = new NoiseDetector({ enterThreshold: 0.6, exitThreshold: 0.4 });
      d.push(0.7);
      d.push(0.5); // in the gap: stays armed, no event
      expect(d.isArmed).toBe(true);
      // Going back above enter while still armed must NOT re-fire.
      expect(d.push(0.7).event).toBeNull();
    });

    it('defaults exitThreshold to enterThreshold (degenerate hysteresis)', () => {
      const d = new NoiseDetector({ enterThreshold: 0.6 });
      expect(d.push(0.7).event).not.toBeNull();
      // Staying strictly above the threshold does not re-fire.
      expect(d.push(0.8).event).toBeNull();
      // Dropping below disarms; a fresh rise re-fires.
      expect(d.push(0.5).event).toBeNull();
      expect(d.push(0.7).event).not.toBeNull();
    });
  });

  describe('cooldown', () => {
    it('suppresses a second event within the cooldown window', () => {
      let now = 0;
      const d = new NoiseDetector(
        { enterThreshold: 0.6, exitThreshold: 0.4, cooldownMs: 1000 },
        () => now,
      );
      now = 0;
      expect(d.push(0.7).event).not.toBeNull();
      now = 100;
      d.push(0.2); // disarm
      now = 500; // within cooldown
      expect(d.push(0.8).event).toBeNull();
    });

    it('allows a new event once the cooldown has elapsed', () => {
      let now = 0;
      const d = new NoiseDetector(
        { enterThreshold: 0.6, exitThreshold: 0.4, cooldownMs: 1000 },
        () => now,
      );
      now = 0;
      expect(d.push(0.7).event).not.toBeNull();
      now = 100;
      d.push(0.2); // disarm
      now = 1200; // past cooldown
      expect(d.push(0.8).event).not.toBeNull();
    });

    it('does not spam events across many loud spikes within one window', () => {
      let now = 0;
      const d = new NoiseDetector(
        { enterThreshold: 0.6, exitThreshold: 0.4, cooldownMs: 5000 },
        () => now,
      );
      let fired = 0;
      const spikes = [0.9, 0.2, 0.95, 0.1, 0.8, 0.3, 0.99];
      for (const s of spikes) {
        now += 200; // 200ms apart, well within the 5s cooldown
        if (d.push(s).event) {
          fired += 1;
        }
      }
      expect(fired).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('ignores NaN without changing state or firing', () => {
      const d = new NoiseDetector({ enterThreshold: 0.6 });
      const { event, armed } = d.push(NaN);
      expect(event).toBeNull();
      expect(armed).toBe(false);
      // A real loud sample after NaN still works.
      expect(d.push(0.9).event).not.toBeNull();
    });

    it('ignores ±Infinity', () => {
      const d = new NoiseDetector({ enterThreshold: 0.6 });
      expect(d.push(Infinity).event).toBeNull();
      expect(d.push(-Infinity).event).toBeNull();
      expect(d.isArmed).toBe(false);
    });

    it('handles negative-scale levels (e.g. dBFS) without false events', () => {
      // dBFS: silence ~ -60, loud ~ -10. enter at -20.
      const d = new NoiseDetector({ enterThreshold: -20, exitThreshold: -30 });
      expect(d.push(-50).event).toBeNull();
      expect(d.push(-10).event).not.toBeNull();
      expect(d.push(-15).event).toBeNull(); // still loud
    });

    it('does not crash on extreme finite values', () => {
      const d = new NoiseDetector({ enterThreshold: 0.6 });
      expect(() => d.push(Number.MAX_VALUE)).not.toThrow();
      expect(d.push(Number.MAX_VALUE).event).toBeNull(); // already armed
      expect(() => d.push(-Number.MAX_VALUE)).not.toThrow();
    });
  });

  describe('config validation', () => {
    it('throws when enterThreshold is not finite', () => {
      expect(() => new NoiseDetector({ enterThreshold: NaN })).toThrow();
      expect(() => new NoiseDetector({ enterThreshold: Infinity })).toThrow();
    });

    it('throws when exitThreshold exceeds enterThreshold', () => {
      expect(
        () => new NoiseDetector({ enterThreshold: 0.5, exitThreshold: 0.6 }),
      ).toThrow();
    });

    it('throws when exitThreshold is not finite', () => {
      expect(
        () => new NoiseDetector({ enterThreshold: 0.5, exitThreshold: NaN }),
      ).toThrow();
    });

    it('throws on a negative or non-finite cooldown', () => {
      expect(
        () => new NoiseDetector({ enterThreshold: 0.5, cooldownMs: -1 }),
      ).toThrow();
      expect(
        () => new NoiseDetector({ enterThreshold: 0.5, cooldownMs: NaN }),
      ).toThrow();
    });
  });

  describe('reset', () => {
    it('clears armed and cooldown state', () => {
      let now = 0;
      const d = new NoiseDetector(
        { enterThreshold: 0.6, exitThreshold: 0.4, cooldownMs: 10_000 },
        () => now,
      );
      d.push(0.9);
      expect(d.isArmed).toBe(true);
      d.reset();
      expect(d.isArmed).toBe(false);
      // After reset, cooldown no longer blocks even at the same timestamp.
      expect(d.push(0.9).event).not.toBeNull();
    });
  });

  describe('privacy', () => {
    it('emits only level/threshold/timestamp — no audio data', () => {
      const d = new NoiseDetector({ enterThreshold: 0.6 }, () => 999);
      const { event } = d.push(0.8);
      expect(event).not.toBeNull();
      expect(Object.keys(event!).sort()).toEqual([
        'level',
        'threshold',
        'timestamp',
        'type',
      ]);
      // Nothing buffer-like / audio-like leaks into the serialized event.
      const serialized = JSON.stringify(event);
      expect(serialized).not.toMatch(/audio|buffer|pcm|samples|wav|raw/i);
    });
  });

  describe('factory', () => {
    it('createNoiseDetector returns a working detector', () => {
      const d = createNoiseDetector({ enterThreshold: 0.6 });
      expect(d).toBeInstanceOf(NoiseDetector);
      expect(d.push(0.9).event).not.toBeNull();
    });
  });
});
