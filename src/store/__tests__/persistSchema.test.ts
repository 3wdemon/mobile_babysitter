import { DEFAULT_PERSISTED_STATE, parsePersistedState } from '../persistSchema';
import type { PersistedState } from '../types';

/**
 * A complete, valid persisted blob (distinct from every default) used to assert
 * that a well-formed value is preserved untouched.
 */
const VALID_STATE: PersistedState = {
  role: 'parent',
  onboardingCompleted: true,
  settings: {
    theme: 'dark',
    alertSoundsEnabled: false,
    noiseThreshold: 0.42,
    motionSensitivity: 0.33,
    biometricLockEnabled: true,
    isPremium: true,
    powerSaverEnabled: false,
    audioOnlyEnabled: false,
    playbackVolume: 0.5,
  },
  freeTierUsage: { usedMs: 123_000, dateKey: '2026-06-02' },
  pinLockout: { failedAttempts: 2, lockedUntil: 1_700_000_000_000, lastFailedAt: 1_699_999_000_000 },
};

describe('parsePersistedState (DMY-43)', () => {
  describe('valid hydration', () => {
    it('preserves a complete, valid blob verbatim', () => {
      expect(parsePersistedState(VALID_STATE)).toEqual(VALID_STATE);
    });

    it('returns a fresh object (does not alias the input or the defaults)', () => {
      const result = parsePersistedState(VALID_STATE);
      expect(result).not.toBe(VALID_STATE);
      expect(result.settings).not.toBe(VALID_STATE.settings);
      expect(result).not.toBe(DEFAULT_PERSISTED_STATE);
    });

    it('strips unknown top-level and nested keys', () => {
      const result = parsePersistedState({
        ...VALID_STATE,
        bogusTopLevel: 'nope',
        settings: { ...VALID_STATE.settings, bogusNested: 999 },
      });
      expect(result).toEqual(VALID_STATE);
      expect(result).not.toHaveProperty('bogusTopLevel');
      expect(result.settings).not.toHaveProperty('bogusNested');
    });
  });

  describe('partial state deep-merged with defaults', () => {
    it('backfills a missing settings field while preserving present ones', () => {
      // Build a settings object that omits `audioOnlyEnabled` entirely.
      const partialSettings = { ...DEFAULT_PERSISTED_STATE.settings };
      delete (partialSettings as Partial<typeof partialSettings>)
        .audioOnlyEnabled;
      const result = parsePersistedState({
        role: 'baby',
        onboardingCompleted: true,
        settings: { ...partialSettings, theme: 'light' },
      });
      // Present field preserved...
      expect(result.settings.theme).toBe('light');
      expect(result.role).toBe('baby');
      // ...missing nested field backfilled to its default...
      expect(result.settings.audioOnlyEnabled).toBe(
        DEFAULT_PERSISTED_STATE.settings.audioOnlyEnabled,
      );
      // ...and the entirely-absent freeTierUsage backfilled too.
      expect(result.freeTierUsage).toEqual(
        DEFAULT_PERSISTED_STATE.freeTierUsage,
      );
    });

    it('backfills entirely-missing nested objects', () => {
      const result = parsePersistedState({ role: 'parent' });
      expect(result.role).toBe('parent');
      expect(result.settings).toEqual(DEFAULT_PERSISTED_STATE.settings);
      expect(result.freeTierUsage).toEqual(
        DEFAULT_PERSISTED_STATE.freeTierUsage,
      );
      expect(result.onboardingCompleted).toBe(false);
    });

    it('backfills a pre-existing field that was missing in an older shape', () => {
      // Pre-DMY-11 blob: no isPremium, no freeTierUsage.
      const result = parsePersistedState({
        role: 'parent',
        onboardingCompleted: true,
        settings: {
          theme: 'dark',
          alertSoundsEnabled: true,
          noiseThreshold: 0.6,
          motionSensitivity: 0.15,
          biometricLockEnabled: false,
          powerSaverEnabled: true,
          audioOnlyEnabled: true,
        },
      });
      expect(result.settings.theme).toBe('dark');
      expect(result.settings.isPremium).toBe(false);
      expect(result.freeTierUsage).toEqual({ usedMs: 0, dateKey: null });
    });
  });

  describe('corrupt / invalid data falls back to defaults', () => {
    // A present-but-non-object blob emits a single warn breadcrumb. Silence it
    // so the assertions under test are not buried in expected logger noise; we
    // assert the breadcrumb explicitly where it matters below.
    let warnSpy: jest.SpyInstance;
    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('logs a breadcrumb (without the value) on a non-object blob', () => {
      parsePersistedState('garbage');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = warnSpy.mock.calls[0].join(' ');
      expect(logged).toContain('persist hydration');
      // The raw value must never be logged.
      expect(logged).not.toContain('garbage');
    });

    it('returns defaults for null / undefined', () => {
      expect(parsePersistedState(undefined)).toEqual(DEFAULT_PERSISTED_STATE);
      expect(parsePersistedState(null)).toEqual(DEFAULT_PERSISTED_STATE);
    });

    it('returns defaults for non-object primitives', () => {
      expect(parsePersistedState('garbage')).toEqual(DEFAULT_PERSISTED_STATE);
      expect(parsePersistedState(12345)).toEqual(DEFAULT_PERSISTED_STATE);
      expect(parsePersistedState(true)).toEqual(DEFAULT_PERSISTED_STATE);
    });

    it('returns defaults for an array (not a valid state object)', () => {
      expect(parsePersistedState([1, 2, 3])).toEqual(DEFAULT_PERSISTED_STATE);
    });

    it('repairs a wrong-typed role to the default', () => {
      expect(parsePersistedState({ role: 12345 }).role).toBeNull();
      expect(parsePersistedState({ role: 'astronaut' }).role).toBeNull();
    });

    it('repairs an out-of-enum theme to the default', () => {
      const result = parsePersistedState({
        settings: { theme: 'neon' },
      });
      expect(result.settings.theme).toBe('system');
    });

    it('clamps/repairs out-of-range and non-finite unit scalars', () => {
      const result = parsePersistedState({
        settings: {
          noiseThreshold: 5, // > 1
          motionSensitivity: 'loud', // wrong type
        },
      });
      expect(result.settings.noiseThreshold).toBe(
        DEFAULT_PERSISTED_STATE.settings.noiseThreshold,
      );
      expect(result.settings.motionSensitivity).toBe(
        DEFAULT_PERSISTED_STATE.settings.motionSensitivity,
      );
    });

    it('preserves a valid in-range playbackVolume (DMY-56)', () => {
      const result = parsePersistedState({
        settings: { ...VALID_STATE.settings, playbackVolume: 0.25 },
      });
      expect(result.settings.playbackVolume).toBe(0.25);
      // 0 (mute) is a valid persisted level, not repaired away.
      const muted = parsePersistedState({
        settings: { ...VALID_STATE.settings, playbackVolume: 0 },
      });
      expect(muted.settings.playbackVolume).toBe(0);
    });

    it('repairs an out-of-range / non-finite playbackVolume to the default (DMY-56)', () => {
      const tooHigh = parsePersistedState({
        settings: { ...VALID_STATE.settings, playbackVolume: 5 },
      });
      expect(tooHigh.settings.playbackVolume).toBe(
        DEFAULT_PERSISTED_STATE.settings.playbackVolume,
      );
      const negative = parsePersistedState({
        settings: { ...VALID_STATE.settings, playbackVolume: -2 },
      });
      expect(negative.settings.playbackVolume).toBe(
        DEFAULT_PERSISTED_STATE.settings.playbackVolume,
      );
      const wrongType = parsePersistedState({
        settings: { ...VALID_STATE.settings, playbackVolume: 'loud' },
      });
      expect(wrongType.settings.playbackVolume).toBe(
        DEFAULT_PERSISTED_STATE.settings.playbackVolume,
      );
    });

    it('backfills a missing playbackVolume to the default (older blob) (DMY-56)', () => {
      const partialSettings = { ...VALID_STATE.settings };
      delete (partialSettings as Partial<typeof partialSettings>)
        .playbackVolume;
      const result = parsePersistedState({
        settings: partialSettings,
      });
      // Missing field backfilled to the full-volume default...
      expect(result.settings.playbackVolume).toBe(
        DEFAULT_PERSISTED_STATE.settings.playbackVolume,
      );
      // ...while present siblings survive untouched.
      expect(result.settings.theme).toBe('dark');
    });

    it('repairs a wrong-typed boolean setting in isolation', () => {
      const result = parsePersistedState({
        settings: { ...VALID_STATE.settings, isPremium: 'yes' },
      });
      // Only the bad field is repaired; valid siblings survive.
      expect(result.settings.isPremium).toBe(false);
      expect(result.settings.theme).toBe('dark');
      expect(result.settings.audioOnlyEnabled).toBe(false);
    });

    it('repairs an invalid freeTierUsage shape', () => {
      const result = parsePersistedState({
        freeTierUsage: { usedMs: -1, dateKey: 'not-a-date' },
      });
      expect(result.freeTierUsage).toEqual({ usedMs: 0, dateKey: null });
    });

    it('repairs a negative / NaN usedMs but keeps a valid dateKey', () => {
      const result = parsePersistedState({
        freeTierUsage: { usedMs: Number.NaN, dateKey: '2026-06-02' },
      });
      expect(result.freeTierUsage.usedMs).toBe(0);
      expect(result.freeTierUsage.dateKey).toBe('2026-06-02');
    });

    // DMY-44 security: a tampered/bit-rotted pinLockout must never smuggle a
    // value that produces a permanent lockout. The schema layer (clock-free)
    // rejects non-finite, negative, and absurd far-future magnitudes; the
    // precise `now + maxCooldownMs` clamp lives in lockoutPolicy (clock-injected).
    describe('pinLockout timestamps (DMY-44)', () => {
      it('repairs a non-finite lockedUntil (Infinity) to the cleared default', () => {
        const result = parsePersistedState({
          pinLockout: {
            failedAttempts: 3,
            lockedUntil: Number.POSITIVE_INFINITY,
            lastFailedAt: null,
          },
        });
        expect(result.pinLockout.lockedUntil).toBeNull();
        expect(result.pinLockout.failedAttempts).toBe(3);
      });

      it('rejects a NEGATIVE lockedUntil / lastFailedAt', () => {
        const result = parsePersistedState({
          pinLockout: {
            failedAttempts: 1,
            lockedUntil: -1,
            lastFailedAt: -123,
          },
        });
        expect(result.pinLockout.lockedUntil).toBeNull();
        expect(result.pinLockout.lastFailedAt).toBeNull();
      });

      it('rejects an absurd far-future lockedUntil (max JS date 8.64e15)', () => {
        // PRE-FIX this passed `z.number().finite()` unchanged (8640000000000000,
        // ~year 275760) → getLockoutStatus would report locked forever.
        const result = parsePersistedState({
          pinLockout: {
            failedAttempts: 1,
            lockedUntil: 8.64e15,
            lastFailedAt: null,
          },
        });
        // Coarse schema ceiling drops the absurd magnitude to the cleared
        // default; the value can no longer cause a stuck lock.
        expect(result.pinLockout.lockedUntil).toBeNull();
      });

      it('keeps a plausible in-range lockedUntil / lastFailedAt', () => {
        const result = parsePersistedState({
          pinLockout: {
            failedAttempts: 2,
            lockedUntil: 1_700_000_030_000,
            lastFailedAt: 1_700_000_000_000,
          },
        });
        expect(result.pinLockout.lockedUntil).toBe(1_700_000_030_000);
        expect(result.pinLockout.lastFailedAt).toBe(1_700_000_000_000);
      });
    });

    // AC1 (DMY-43): a persisted blob whose `settings` is null / missing / a
    // non-object MUST normalize to the full default settings shape — it is not
    // enough that hydration merely doesn't throw. Each case is asserted to carry
    // the required `theme`/`alertSoundsEnabled` subfields with valid values, and
    // to equal the canonical default settings object outright.
    it.each<[string, unknown]>([
      ['settings: null', { role: 'parent', settings: null }],
      ['settings missing entirely', { role: 'parent' }],
      ['settings: non-object string', { role: 'parent', settings: 'nope' }],
      ['settings: number', { role: 'parent', settings: 42 }],
      ['settings: array', { role: 'parent', settings: [] }],
      [
        'settings: array-of-objects (not a plain object)',
        { role: 'parent', settings: [{ theme: 'dark' }] },
      ],
    ])(
      'normalizes %s to the default settings shape (theme/alertSoundsEnabled present)',
      (_name, blob) => {
        const result = parsePersistedState(blob);
        // Required subfields are present (AC1 wording).
        expect(result.settings).toHaveProperty('theme');
        expect(result.settings).toHaveProperty('alertSoundsEnabled');
        // ...with valid values, not undefined holes.
        expect(['system', 'light', 'dark']).toContain(result.settings.theme);
        expect(typeof result.settings.alertSoundsEnabled).toBe('boolean');
        // ...and the whole object equals the canonical default settings.
        expect(result.settings).toEqual(DEFAULT_PERSISTED_STATE.settings);
        // The sibling valid field is still recovered (per-field resilience).
        expect(result.role).toBe('parent');
      },
    );

    // AC2 (DMY-43): a corrupt / partial shape must not crash when a consumer
    // READS `settings.theme`. We assert the read itself (a) does not throw and
    // (b) yields a valid theme value, on a spread of corrupt shapes — stronger
    // than the bare not-throw guard below.
    it.each<[string, unknown]>([
      ['settings: null', { settings: null }],
      ['settings: empty object', { settings: {} }],
      ['theme: out-of-enum', { settings: { theme: 'neon' } }],
      ['theme: wrong type (number)', { settings: { theme: 5 } }],
      ['theme: NaN', { settings: { theme: Number.NaN } }],
      ['theme: object', { settings: { theme: { nested: true } } }],
      ['completely empty blob', {}],
      ['blob with only unknown keys', { totally: 'unknown', keys: 1 }],
    ])(
      'reading settings.theme is safe and valid after %s',
      (_name, blob) => {
        const result = parsePersistedState(blob);
        let theme: string | undefined;
        expect(() => {
          // Simulate a consumer that reads the field directly (e.g. useTheme).
          theme = result.settings.theme;
        }).not.toThrow();
        expect(['system', 'light', 'dark']).toContain(theme);
      },
    );

    it('never throws on adversarial input', () => {
      const adversarial: unknown[] = [
        { settings: 'not-an-object' },
        { settings: null },
        { freeTierUsage: 42 },
        { role: {}, settings: [], freeTierUsage: 'x' },
        Object.create(null),
        Symbol('x'),
        () => undefined,
        NaN,
      ];
      for (const value of adversarial) {
        expect(() => parsePersistedState(value)).not.toThrow();
      }
    });

    it('respects an injected defaults object', () => {
      const customDefaults: PersistedState = {
        ...DEFAULT_PERSISTED_STATE,
        role: 'baby',
        settings: { ...DEFAULT_PERSISTED_STATE.settings, theme: 'light' },
      };
      // Corrupt blob -> falls back to the INJECTED defaults, not the module ones.
      const result = parsePersistedState({ role: 999 }, customDefaults);
      expect(result.role).toBe('baby');
      expect(result.settings.theme).toBe('light');
    });
  });
});
