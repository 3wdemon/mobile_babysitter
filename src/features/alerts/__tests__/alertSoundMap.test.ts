/**
 * Unit tests for the per-event-type sound map (DMY-26).
 *
 * The KEY acceptance criterion lives here: every alert type maps to a DIFFERENT
 * sound identifier, and the priority ordering (cry > no_motion > motion > noise)
 * is what the orchestration relies on.
 */
import {
  SOUND_BY_ALERT_TYPE,
  configForType,
  soundIdForType,
} from '../alertSoundMap';
import type { AlertType } from '../alertTypes';

const ALL_TYPES: AlertType[] = ['cry', 'motion', 'noise', 'no_motion'];

describe('SOUND_BY_ALERT_TYPE', () => {
  it('maps every alert type to a DISTINCT sound id (core DMY-26 AC)', () => {
    const ids = ALL_TYPES.map(soundIdForType);
    const unique = new Set(ids);
    expect(unique.size).toBe(ALL_TYPES.length);
  });

  it('has a concrete, non-empty sound id for each type', () => {
    for (const type of ALL_TYPES) {
      const id = soundIdForType(type);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('orders priority cry > no_motion > motion > noise', () => {
    const p = (t: AlertType) => configForType(t).priority;
    expect(p('cry')).toBeGreaterThan(p('no_motion'));
    expect(p('no_motion')).toBeGreaterThan(p('motion'));
    expect(p('motion')).toBeGreaterThan(p('noise'));
  });

  it('assigns a strictly positive cooldown to every type', () => {
    for (const type of ALL_TYPES) {
      expect(configForType(type).cooldownMs).toBeGreaterThan(0);
    }
  });

  it('keeps volume hints within 0..1 when present', () => {
    for (const type of ALL_TYPES) {
      const { volume } = configForType(type);
      if (volume !== undefined) {
        expect(volume).toBeGreaterThanOrEqual(0);
        expect(volume).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is frozen so a stray write cannot change another event sound', () => {
    expect(Object.isFrozen(SOUND_BY_ALERT_TYPE)).toBe(true);
  });
});
