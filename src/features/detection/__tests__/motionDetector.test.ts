/**
 * Unit tests for the pure motion / no-motion detection core (DMY-25).
 *
 * Covers: motion above/below threshold, hysteresis (no re-fire while moving,
 * re-fire only on a fresh rising edge), cooldown rate-limiting, the >30s
 * no-motion rule (fires exactly at the threshold, never early; motion resets the
 * timer; fires at most once per stretch), `tick()` time advancement, config
 * validation, edge cases (NaN/±Infinity/negative/extreme) and the privacy
 * guarantee that events carry no frame data.
 *
 * Time is driven by an injected mutable `now` so all timing is deterministic.
 */
import { NO_MOTION_THRESHOLD_MS } from '../motionConfig';
import { createMotionDetector, MotionDetector } from '../motionDetector';

/** Standard test config: clear motion band + 30s stillness rule. */
function makeDetector(now: () => number, overrides = {}) {
  return new MotionDetector(
    {
      enterThreshold: 0.15,
      exitThreshold: 0.08,
      cooldownMs: 5000,
      noMotionThresholdMs: NO_MOTION_THRESHOLD_MS,
      ...overrides,
    },
    now,
  );
}

describe('MotionDetector', () => {
  describe('motion threshold', () => {
    it('emits a motion event when the metric reaches the enter threshold', () => {
      const d = makeDetector(() => 1000);
      const { event, moving } = d.push(0.3);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('motion');
      expect(event?.metric).toBe(0.3);
      expect(event?.threshold).toBe(0.15);
      expect(event?.timestamp).toBe(1000);
      expect(moving).toBe(true);
    });

    it('does not emit below the enter threshold', () => {
      const d = makeDetector(() => 0);
      expect(d.push(0.02).event).toBeNull();
      expect(d.push(0.07).event).toBeNull();
      expect(d.isMoving).toBe(false);
    });

    it('treats the enter threshold as inclusive (>=)', () => {
      const d = makeDetector(() => 0);
      expect(d.push(0.15).event).not.toBeNull();
    });
  });

  describe('hysteresis (anti-jitter)', () => {
    it('does not re-fire motion while the metric stays in the moving band', () => {
      const d = makeDetector(() => 0);
      expect(d.push(0.3).event).not.toBeNull(); // rising edge -> fire
      expect(d.push(0.4).event).toBeNull(); // still moving -> no spam
      expect(d.push(0.2).event).toBeNull();
      expect(d.push(0.1).event).toBeNull(); // in the gap, still moving
      expect(d.isMoving).toBe(true);
    });

    it('re-fires motion only after dropping below exit then a fresh rise', () => {
      let now = 0;
      const d = makeDetector(() => now, { cooldownMs: 0 });
      expect(d.push(0.3).event).not.toBeNull();
      now = 100;
      expect(d.push(0.05).event).toBeNull(); // falling edge -> still
      expect(d.isMoving).toBe(false);
      now = 200;
      expect(d.push(0.3).event).not.toBeNull(); // fresh rising edge -> fire
    });

    it('does not break stillness while merely in the hysteresis gap', () => {
      // A metric in (exit, enter) while moving keeps the scene "moving" and does
      // NOT start a stillness timer.
      let now = 0;
      const d = makeDetector(() => now);
      d.push(0.3); // moving
      now = 1000;
      d.push(0.1); // gap: still considered moving, no stillness timer
      expect(d.isMoving).toBe(true);
      now = NO_MOTION_THRESHOLD_MS + 5000;
      // No stillness timer was running, so tick() yields nothing.
      expect(d.tick()).toBeNull();
    });
  });

  describe('motion cooldown (anti-spam)', () => {
    it('suppresses a second motion event within the cooldown window', () => {
      let now = 0;
      const d = makeDetector(() => now, { cooldownMs: 1000 });
      expect(d.push(0.3).event).not.toBeNull();
      now = 100;
      d.push(0.02); // disarm
      now = 500; // within cooldown
      expect(d.push(0.3).event).toBeNull();
      expect(d.isMoving).toBe(true); // armed, just rate-limited
    });

    it('allows a new motion event once the cooldown has elapsed', () => {
      let now = 0;
      const d = makeDetector(() => now, { cooldownMs: 1000 });
      expect(d.push(0.3).event).not.toBeNull();
      now = 100;
      d.push(0.02);
      now = 1200; // past cooldown
      expect(d.push(0.3).event).not.toBeNull();
    });

    it('does not spam motion across continuous fidgeting in one window', () => {
      let now = 0;
      const d = makeDetector(() => now, { cooldownMs: 5000 });
      let fired = 0;
      const spikes = [0.3, 0.02, 0.4, 0.01, 0.5, 0.03, 0.6];
      for (const s of spikes) {
        now += 200;
        if (d.push(s).event) {
          fired += 1;
        }
      }
      expect(fired).toBe(1);
    });
  });

  describe('no-motion (>30s stillness) rule', () => {
    it('fires no_motion exactly after the threshold, not before', () => {
      let now = 0;
      const d = makeDetector(() => now);
      d.push(0.01); // still from t=0
      now = NO_MOTION_THRESHOLD_MS - 1;
      expect(d.tick()).toBeNull(); // 1ms short -> nothing
      now = NO_MOTION_THRESHOLD_MS;
      const event = d.tick();
      expect(event).not.toBeNull();
      expect(event?.type).toBe('no_motion');
      expect(event?.timestamp).toBe(NO_MOTION_THRESHOLD_MS);
    });

    it('can fire no_motion from push() too (still sample at/after threshold)', () => {
      let now = 0;
      const d = makeDetector(() => now);
      d.push(0.01); // still from t=0
      now = NO_MOTION_THRESHOLD_MS + 100;
      const { event } = d.push(0.02); // still, threshold elapsed
      expect(event?.type).toBe('no_motion');
    });

    it('fires no_motion at most once per still stretch', () => {
      let now = 0;
      const d = makeDetector(() => now);
      d.push(0.01);
      now = NO_MOTION_THRESHOLD_MS;
      expect(d.tick()?.type).toBe('no_motion');
      now = NO_MOTION_THRESHOLD_MS + 10000;
      expect(d.tick()).toBeNull(); // already fired -> silent
    });

    it('resets the stillness timer when motion occurs', () => {
      let now = 0;
      const d = makeDetector(() => now, { cooldownMs: 0 });
      d.push(0.01); // still from t=0
      now = 20000; // 20s of stillness
      d.push(0.3); // MOTION -> resets timer
      expect(d.isMoving).toBe(true);
      now = 25000;
      d.push(0.01); // still again, restart timer at 25000
      now = 25000 + NO_MOTION_THRESHOLD_MS - 1;
      expect(d.tick()).toBeNull(); // not yet 30s since restart
      now = 25000 + NO_MOTION_THRESHOLD_MS;
      expect(d.tick()?.type).toBe('no_motion');
    });

    it('re-arms no_motion for a NEW still stretch after motion', () => {
      let now = 0;
      const d = makeDetector(() => now, { cooldownMs: 0 });
      d.push(0.01);
      now = NO_MOTION_THRESHOLD_MS;
      expect(d.tick()?.type).toBe('no_motion'); // stretch 1
      now += 1000;
      d.push(0.3); // motion
      now += 1000;
      d.push(0.01); // new still stretch
      now += NO_MOTION_THRESHOLD_MS;
      expect(d.tick()?.type).toBe('no_motion'); // stretch 2 fires again
    });

    it('does not start a stillness timer before any sample', () => {
      const d = makeDetector(() => NO_MOTION_THRESHOLD_MS + 999999);
      expect(d.tick()).toBeNull();
    });

    it('carries the last metric on the no_motion event (privacy: a scalar)', () => {
      let now = 0;
      const d = makeDetector(() => now);
      d.push(0.04);
      now = NO_MOTION_THRESHOLD_MS;
      const event = d.tick();
      expect(event?.metric).toBe(0.04);
    });
  });

  describe('motion precedence', () => {
    it('a single sample emits motion (not no_motion) on a rising edge', () => {
      let now = 0;
      const d = makeDetector(() => now);
      d.push(0.01); // still from t=0
      now = NO_MOTION_THRESHOLD_MS + 5000; // stillness long overdue
      const { event } = d.push(0.3); // but this sample is MOTION
      expect(event?.type).toBe('motion');
    });
  });

  describe('edge cases', () => {
    it('ignores NaN without changing state, firing, or touching the timer', () => {
      let now = 0;
      const d = makeDetector(() => now);
      d.push(0.01); // still from t=0
      now = 10000;
      const { event, moving } = d.push(NaN);
      expect(event).toBeNull();
      expect(moving).toBe(false);
      // The stillness timer was NOT reset by the NaN: 30s from t=0 still fires.
      now = NO_MOTION_THRESHOLD_MS;
      expect(d.tick()?.type).toBe('no_motion');
    });

    it('ignores ±Infinity', () => {
      const d = makeDetector(() => 0);
      expect(d.push(Infinity).event).toBeNull();
      expect(d.push(-Infinity).event).toBeNull();
      expect(d.isMoving).toBe(false);
    });

    it('handles negative-scale metrics without false events', () => {
      const d = new MotionDetector(
        { enterThreshold: -10, exitThreshold: -20, noMotionThresholdMs: 1000 },
        () => 0,
      );
      expect(d.push(-50).event).toBeNull(); // still
      expect(d.push(-5).event).not.toBeNull(); // motion
    });

    it('does not crash on extreme finite values', () => {
      const d = makeDetector(() => 0);
      expect(() => d.push(Number.MAX_VALUE)).not.toThrow();
      expect(() => d.push(-Number.MAX_VALUE)).not.toThrow();
    });
  });

  describe('config validation', () => {
    it('throws when enterThreshold is not finite', () => {
      expect(() => new MotionDetector({ enterThreshold: NaN })).toThrow();
      expect(() => new MotionDetector({ enterThreshold: Infinity })).toThrow();
    });

    it('throws when exitThreshold exceeds enterThreshold', () => {
      expect(
        () => new MotionDetector({ enterThreshold: 0.1, exitThreshold: 0.2 }),
      ).toThrow();
    });

    it('throws when exitThreshold is not finite', () => {
      expect(
        () => new MotionDetector({ enterThreshold: 0.1, exitThreshold: NaN }),
      ).toThrow();
    });

    it('throws on a negative or non-finite cooldown', () => {
      expect(
        () => new MotionDetector({ enterThreshold: 0.1, cooldownMs: -1 }),
      ).toThrow();
      expect(
        () => new MotionDetector({ enterThreshold: 0.1, cooldownMs: NaN }),
      ).toThrow();
    });

    it('throws on a non-positive or non-finite noMotionThresholdMs', () => {
      expect(
        () =>
          new MotionDetector({ enterThreshold: 0.1, noMotionThresholdMs: 0 }),
      ).toThrow();
      expect(
        () =>
          new MotionDetector({ enterThreshold: 0.1, noMotionThresholdMs: -5 }),
      ).toThrow();
      expect(
        () =>
          new MotionDetector({ enterThreshold: 0.1, noMotionThresholdMs: NaN }),
      ).toThrow();
    });

    it('defaults noMotionThresholdMs to 30s', () => {
      let now = 0;
      const d = new MotionDetector({ enterThreshold: 0.15 }, () => now);
      d.push(0.0);
      now = NO_MOTION_THRESHOLD_MS - 1;
      expect(d.tick()).toBeNull();
      now = NO_MOTION_THRESHOLD_MS;
      expect(d.tick()?.type).toBe('no_motion');
    });

    it('defaults exitThreshold to enterThreshold (degenerate hysteresis)', () => {
      let now = 0;
      const d = new MotionDetector(
        { enterThreshold: 0.2, cooldownMs: 0 },
        () => now,
      );
      expect(d.push(0.3).event).not.toBeNull();
      now = 1;
      expect(d.push(0.1).event).toBeNull(); // below enter -> disarm
      now = 2;
      expect(d.push(0.3).event).not.toBeNull(); // fresh rise
    });
  });

  describe('reset', () => {
    it('clears moving, cooldown and stillness state', () => {
      let now = 0;
      const d = makeDetector(() => now, { cooldownMs: 10000 });
      d.push(0.3);
      expect(d.isMoving).toBe(true);
      d.reset();
      expect(d.isMoving).toBe(false);
      // After reset, cooldown no longer blocks even at the same timestamp.
      expect(d.push(0.3).event).not.toBeNull();
    });
  });

  describe('privacy', () => {
    it('motion event has only type/timestamp/metric/threshold — no frame', () => {
      const d = makeDetector(() => 999);
      const { event } = d.push(0.5);
      expect(event).not.toBeNull();
      expect(Object.keys(event!).sort()).toEqual([
        'metric',
        'threshold',
        'timestamp',
        'type',
      ]);
      const serialized = JSON.stringify(event);
      expect(serialized).not.toMatch(
        /frame|pixel|image|buffer|jpeg|png|rgb|bitmap|video/i,
      );
    });

    it('no_motion event carries no frame data', () => {
      let now = 0;
      const d = makeDetector(() => now);
      d.push(0.01);
      now = NO_MOTION_THRESHOLD_MS;
      const event = d.tick();
      const serialized = JSON.stringify(event);
      expect(serialized).not.toMatch(
        /frame|pixel|image|buffer|jpeg|png|rgb|bitmap|video/i,
      );
    });
  });

  describe('factory', () => {
    it('createMotionDetector returns a working detector', () => {
      const d = createMotionDetector({ enterThreshold: 0.15 });
      expect(d).toBeInstanceOf(MotionDetector);
      expect(d.push(0.3).event).not.toBeNull();
    });
  });
});
