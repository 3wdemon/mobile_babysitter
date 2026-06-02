/**
 * Module-resolution fallback tests for createBatterySource (DMY-54).
 *
 * This is AC #3: "device-info unavailable (Jest) -> noop yields a neutral
 * unknown state, no crash." The default factory `createBatterySource()` lazily
 * `require()`s the native `react-native-device-info` package; when that require
 * throws (native bridge unlinked / bare JS) or returns a malformed module, it
 * must degrade to the neutral noop source rather than crash.
 *
 * These cases are kept in their OWN file (not the main batteryStatus suite)
 * because they mutate the module registry per-test via `jest.doMock` +
 * `jest.isolateModules`; isolating them here guarantees that mutation cannot
 * leak into the seam-wiring assertions the main suite makes.
 */

interface BatteryStateLike {
  readonly level: number | null;
  readonly isCharging: boolean | null;
  readonly isLow: boolean;
}

describe('createBatterySource — device-info unavailable / malformed (AC #3)', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('falls back to the neutral noop source when require() throws', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native-device-info', () => {
        throw new Error('native module not linked');
      });
      const mod = require('../batteryStatus');
      const source = mod.createBatterySource();

      expect(source.getCurrent()).toEqual(mod.UNKNOWN_BATTERY_STATE);
      expect(source.getCurrent().level).toBeNull();
      expect(source.getCurrent().isCharging).toBeNull();
      expect(source.getCurrent().isLow).toBe(false);

      const seen: BatteryStateLike[] = [];
      const unsubscribe = source.subscribe((s: BatteryStateLike) => seen.push(s));
      expect(seen).toEqual([mod.UNKNOWN_BATTERY_STATE]);
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  it('falls back to the noop when the module resolves but is malformed', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native-device-info', () => ({ default: {} }));
      const mod = require('../batteryStatus');
      const source = mod.createBatterySource();

      expect(source.getCurrent()).toEqual(mod.UNKNOWN_BATTERY_STATE);
      const seen: BatteryStateLike[] = [];
      expect(() => source.subscribe((s: BatteryStateLike) => seen.push(s))).not.toThrow();
      expect(seen).toEqual([mod.UNKNOWN_BATTERY_STATE]);
    });
  });

  it('falls back to the noop when the module default is null', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native-device-info', () => ({ default: null }));
      const mod = require('../batteryStatus');
      const source = mod.createBatterySource();
      expect(source.getCurrent()).toEqual(mod.UNKNOWN_BATTERY_STATE);
    });
  });

  it('builds a real source when the module exposes the expected API', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native-device-info', () => ({
        default: {
          getBatteryLevel: () => Promise.resolve(0.9),
          isBatteryCharging: () => Promise.resolve(true),
          addPowerStateListener: () => ({ remove: () => {} }),
        },
      }));
      const mod = require('../batteryStatus');
      const source = mod.createBatterySource();
      // Not the noop: it builds a working source (initial read settles async).
      expect(() => source.subscribe(() => {})()).not.toThrow();
    });
  });

  it('getBatterySource memoises a single shared source; __set resets the memo', () => {
    jest.isolateModules(() => {
      // Use a working module so each build yields a DISTINCT source object
      // (the noop is a shared singleton and would compare equal after reset).
      jest.doMock('react-native-device-info', () => ({
        default: {
          getBatteryLevel: () => Promise.resolve(0.9),
          isBatteryCharging: () => Promise.resolve(true),
          addPowerStateListener: () => ({ remove: () => {} }),
        },
      }));
      const mod = require('../batteryStatus');
      const a = mod.getBatterySource();
      const b = mod.getBatterySource();
      expect(a).toBe(b);
      // __setBatterySource(null) clears the memo so the next call rebuilds.
      mod.__setBatterySource(null);
      const c = mod.getBatterySource();
      expect(c).not.toBe(a);
    });
  });
});
