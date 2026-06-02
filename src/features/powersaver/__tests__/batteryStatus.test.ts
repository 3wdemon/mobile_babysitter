/**
 * Unit tests for the battery-status seam (DMY-54).
 *
 * Covers the pure derivation (computeIsLow / normalizeLevel / mapPowerState),
 * the device-info-backed source wiring (initial read, live power-state events,
 * level↔charging transitions, subscribe/unsubscribe), and the noop source. The
 * require()-driven factory fallback lives in its own file (see
 * createBatterySource.fallback.test.ts) so its module-registry mutation can't
 * leak here.
 */
import {
  LOW_BATTERY_THRESHOLD,
  UNKNOWN_BATTERY_STATE,
  computeIsLow,
  createSourceFromDeviceInfo,
  makeBatteryState,
  mapPowerState,
  noopBatterySource,
  normalizeLevel,
  type BatteryListener,
  type BatteryState,
  type DeviceInfoLike,
} from '../batteryStatus';

/**
 * A controllable fake device-info module. Resolves the seeded level/charging on
 * read and exposes `emit()` to push a power-state event to the live listener.
 */
function createFakeDeviceInfo(initial: {
  level?: number;
  charging?: boolean;
}) {
  let level = initial.level ?? 0.5;
  let charging = initial.charging ?? false;
  let listener: ((p: { batteryLevel?: number; batteryState?: string }) => void) | null =
    null;
  const calls = { addListener: 0, remove: 0 };

  const deviceInfo: DeviceInfoLike = {
    getBatteryLevel: () => Promise.resolve(level),
    isBatteryCharging: () => Promise.resolve(charging),
    addPowerStateListener: l => {
      calls.addListener += 1;
      listener = l;
      return {
        remove: () => {
          calls.remove += 1;
          listener = null;
        },
      };
    },
  };

  return {
    deviceInfo,
    calls,
    emit(payload: { batteryLevel?: number; batteryState?: string }) {
      if (typeof payload.batteryLevel === 'number') {
        level = payload.batteryLevel;
      }
      listener?.(payload);
    },
  };
}

/** Flush pending microtasks so the source's initial Promise.all settles. */
const flush = () => Promise.resolve().then(() => Promise.resolve());

describe('computeIsLow (threshold + charging suppression)', () => {
  it('is false for an unknown level', () => {
    expect(computeIsLow(null, false)).toBe(false);
    expect(computeIsLow(null, true)).toBe(false);
    expect(computeIsLow(null, null)).toBe(false);
  });

  it('is true just under 20% and off-charger', () => {
    expect(computeIsLow(0.19, false)).toBe(true);
    expect(computeIsLow(0.05, false)).toBe(true);
  });

  it('is false at EXACTLY the 20% boundary (strictly below only)', () => {
    expect(computeIsLow(LOW_BATTERY_THRESHOLD, false)).toBe(false);
    expect(computeIsLow(0.2, false)).toBe(false);
  });

  it('is false at and above 20%', () => {
    expect(computeIsLow(0.2, false)).toBe(false);
    expect(computeIsLow(0.5, false)).toBe(false);
    expect(computeIsLow(1, false)).toBe(false);
  });

  it('charging suppresses the warning even at a low level', () => {
    expect(computeIsLow(0.05, true)).toBe(false);
    expect(computeIsLow(0.19, true)).toBe(false);
  });

  it('an UNKNOWN charging state does NOT suppress the warning (pessimistic)', () => {
    expect(computeIsLow(0.1, null)).toBe(true);
  });
});

describe('normalizeLevel', () => {
  it('passes through a fraction in [0,1]', () => {
    expect(normalizeLevel(0)).toBe(0);
    expect(normalizeLevel(0.42)).toBe(0.42);
    expect(normalizeLevel(1)).toBe(1);
  });

  it('maps device-info -1 (unknown) and bad inputs to null', () => {
    expect(normalizeLevel(-1)).toBeNull();
    expect(normalizeLevel(NaN)).toBeNull();
    expect(normalizeLevel(undefined)).toBeNull();
    expect(normalizeLevel(null)).toBeNull();
  });

  it('clamps a momentary >1 reading to 1', () => {
    expect(normalizeLevel(1.04)).toBe(1);
  });
});

describe('mapPowerState', () => {
  it('treats charging/full as charging=true', () => {
    expect(mapPowerState({ batteryLevel: 0.3, batteryState: 'charging' })).toEqual<
      BatteryState
    >({ level: 0.3, isCharging: true, isLow: false });
    expect(mapPowerState({ batteryLevel: 1, batteryState: 'full' }).isCharging).toBe(
      true,
    );
  });

  it('treats unplugged as charging=false and derives isLow', () => {
    expect(mapPowerState({ batteryLevel: 0.1, batteryState: 'unplugged' })).toEqual<
      BatteryState
    >({ level: 0.1, isCharging: false, isLow: true });
  });

  it('treats unknown/missing batteryState as charging=null', () => {
    expect(mapPowerState({ batteryLevel: 0.5, batteryState: 'unknown' }).isCharging).toBeNull();
    expect(mapPowerState({ batteryLevel: 0.5 }).isCharging).toBeNull();
  });
});

describe('makeBatteryState', () => {
  it('assembles state and derives isLow', () => {
    expect(makeBatteryState(0.1, false)).toEqual<BatteryState>({
      level: 0.1,
      isCharging: false,
      isLow: true,
    });
  });
});

describe('noopBatterySource', () => {
  it('getCurrent returns the neutral UNKNOWN state', () => {
    expect(noopBatterySource.getCurrent()).toEqual(UNKNOWN_BATTERY_STATE);
    expect(noopBatterySource.getCurrent().level).toBeNull();
    expect(noopBatterySource.getCurrent().isCharging).toBeNull();
    expect(noopBatterySource.getCurrent().isLow).toBe(false);
  });

  it('emits the UNKNOWN snapshot once on subscribe, never changes, never throws', () => {
    const seen: BatteryState[] = [];
    const unsubscribe = noopBatterySource.subscribe(s => seen.push(s));
    expect(seen).toEqual([UNKNOWN_BATTERY_STATE]);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('isolates a throwing subscriber', () => {
    const throwingListener: BatteryListener = () => {
      throw new Error('boom');
    };
    expect(() => noopBatterySource.subscribe(throwingListener)).not.toThrow();
  });
});

describe('createSourceFromDeviceInfo', () => {
  it('seeds the snapshot from the initial async read', async () => {
    const fake = createFakeDeviceInfo({ level: 0.42, charging: false });
    const source = createSourceFromDeviceInfo(fake.deviceInfo);

    // Before the read settles, getCurrent is the UNKNOWN default.
    expect(source.getCurrent()).toEqual(UNKNOWN_BATTERY_STATE);

    await flush();

    expect(source.getCurrent()).toEqual<BatteryState>({
      level: 0.42,
      isCharging: false,
      isLow: false,
    });
  });

  it('emits the current snapshot to a subscriber on subscribe', async () => {
    const fake = createFakeDeviceInfo({ level: 0.6, charging: true });
    const source = createSourceFromDeviceInfo(fake.deviceInfo);
    await flush();

    const seen: BatteryState[] = [];
    source.subscribe(s => seen.push(s));
    expect(seen[0]).toEqual<BatteryState>({
      level: 0.6,
      isCharging: true,
      isLow: false,
    });
  });

  it('updates on a power-state event (level transition into low)', async () => {
    const fake = createFakeDeviceInfo({ level: 0.5, charging: false });
    const source = createSourceFromDeviceInfo(fake.deviceInfo);
    await flush();

    const seen: BatteryState[] = [];
    source.subscribe(s => seen.push(s));

    fake.emit({ batteryLevel: 0.15, batteryState: 'unplugged' });
    expect(source.getCurrent()).toEqual<BatteryState>({
      level: 0.15,
      isCharging: false,
      isLow: true,
    });
    expect(seen[seen.length - 1].isLow).toBe(true);
  });

  it('charging transition suppresses the low warning at the same level', async () => {
    const fake = createFakeDeviceInfo({ level: 0.1, charging: false });
    const source = createSourceFromDeviceInfo(fake.deviceInfo);
    await flush();
    expect(source.getCurrent().isLow).toBe(true);

    const seen: BatteryState[] = [];
    source.subscribe(s => seen.push(s));
    fake.emit({ batteryLevel: 0.1, batteryState: 'charging' });

    expect(source.getCurrent()).toEqual<BatteryState>({
      level: 0.1,
      isCharging: true,
      isLow: false,
    });
  });

  it('a power-state event that omits a field does not clobber the known value', async () => {
    const fake = createFakeDeviceInfo({ level: 0.5, charging: true });
    const source = createSourceFromDeviceInfo(fake.deviceInfo);
    await flush();

    source.subscribe(() => {});
    // Level-only event (no batteryState) must keep the known charging=true.
    fake.emit({ batteryLevel: 0.3 });
    expect(source.getCurrent().isCharging).toBe(true);
    expect(source.getCurrent().level).toBe(0.3);
  });

  it('subscribes once and removes the listener on unsubscribe', async () => {
    const fake = createFakeDeviceInfo({ level: 0.5 });
    const source = createSourceFromDeviceInfo(fake.deviceInfo);
    await flush();

    const unsubscribe = source.subscribe(() => {});
    expect(fake.calls.addListener).toBe(1);
    expect(fake.calls.remove).toBe(0);
    unsubscribe();
    expect(fake.calls.remove).toBe(1);
  });

  it('falls back to addBatteryLevelListener when power-state is unavailable', async () => {
    const captured: {
      listener: ((p: { batteryLevel: number }) => void) | null;
    } = { listener: null };
    const deviceInfo: DeviceInfoLike = {
      getBatteryLevel: () => Promise.resolve(0.5),
      isBatteryCharging: () => Promise.resolve(false),
      addBatteryLevelListener: l => {
        captured.listener = l;
        return { remove: () => {} };
      },
    };
    const source = createSourceFromDeviceInfo(deviceInfo);
    await flush();

    const seen: BatteryState[] = [];
    source.subscribe(s => seen.push(s));
    captured.listener?.({ batteryLevel: 0.18 });
    // Level-only update; charging stays last-known (false), so isLow is true.
    expect(source.getCurrent()).toEqual<BatteryState>({
      level: 0.18,
      isCharging: false,
      isLow: true,
    });
  });

  it('keeps the UNKNOWN default when the initial read rejects', async () => {
    const deviceInfo: DeviceInfoLike = {
      getBatteryLevel: () => Promise.reject(new Error('no native')),
      isBatteryCharging: () => Promise.resolve(false),
      addPowerStateListener: () => ({ remove: () => {} }),
    };
    const source = createSourceFromDeviceInfo(deviceInfo);
    await flush();
    expect(source.getCurrent()).toEqual(UNKNOWN_BATTERY_STATE);
  });

  it('never throws on teardown if remove() throws', async () => {
    const deviceInfo: DeviceInfoLike = {
      getBatteryLevel: () => Promise.resolve(0.5),
      isBatteryCharging: () => Promise.resolve(false),
      addPowerStateListener: () => ({
        remove: () => {
          throw new Error('teardown boom');
        },
      }),
    };
    const source = createSourceFromDeviceInfo(deviceInfo);
    await flush();
    const unsubscribe = source.subscribe(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
