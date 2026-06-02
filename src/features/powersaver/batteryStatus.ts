/**
 * batteryStatus — baby-unit battery level + charging detection behind a seam
 * (DMY-54).
 *
 * Mobile Babysitter is P2P-only: the baby phone has to stay alive all night for
 * the monitor to keep working, so "how much battery is left, and is it on the
 * charger?" is a first-class, surfaced signal — a dying baby unit is a dropped
 * monitor. This module owns ONLY the small, testable contract; the actual
 * battery data is whatever {@link BatterySource} is injected.
 *
 * ## Design boundary (HONEST)
 * `BatteryState` exposes exactly what the indicator needs today: `level`
 * (0..1 fraction, or `null` when unknown), `isCharging` (`true`/`false`, or
 * `null` when unknown) and the derived `isLow`. Richer details (mAh, health,
 * temperature) are intentionally out of scope and never leave the device
 * anyway.
 *
 * `isLow` is derived in ONE place — {@link computeIsLow} — so the threshold and
 * the "charging suppresses the warning" rule live together and are unit-tested
 * at the boundary:
 *   `isLow = level != null && level < LOW_BATTERY_THRESHOLD && isCharging !== true`.
 * Charging suppresses the warning (a phone on the charger is not at risk even at
 * 5%); an unknown charging state does NOT suppress it (we warn pessimistically
 * when we cannot prove it is charging).
 *
 * ## Source selection (Jest / missing-module safe)
 * The default source ({@link createBatterySource}) adapts
 * `react-native-device-info`. Under Jest / bare JS / before the native module is
 * linked it transparently falls back to {@link noopBatterySource}, which yields
 * a neutral UNKNOWN state (level null, charging null, not low) and never throws —
 * the same "fail safe" posture as the network (netinfo) and discovery (zeroconf)
 * seams. Unknown (rather than, say, 100%) is the honest neutral: a degraded
 * detector must neither raise a false low-battery alarm nor falsely claim the
 * unit is full.
 *
 * ## Privacy
 * Only the coarse level/charging pair is read; nothing is logged with PII and
 * nothing leaves the device. Failures degrade silently to the neutral noop.
 */
import { logger } from '../../services/logger';

/** Battery fraction below which (and off-charger) we warn. 20% per AC. */
export const LOW_BATTERY_THRESHOLD = 0.2;

/** Coarse, UI-facing snapshot of the device battery. */
export interface BatteryState {
  /**
   * Battery charge as a fraction in `[0, 1]`, or `null` when unknown (noop
   * source / before any data arrives / read failure).
   */
  readonly level: number | null;
  /**
   * Whether the device is charging: `true`/`false` when known, `null` when
   * unknown.
   */
  readonly isCharging: boolean | null;
  /** Derived low-battery flag (see {@link computeIsLow}). */
  readonly isLow: boolean;
}

/** Listener notified whenever the battery state changes. */
export type BatteryListener = (state: BatteryState) => void;

/**
 * The seam. A source can be subscribed to (returns an unsubscribe) and can be
 * polled for its current snapshot. Implementations must NEVER throw from these
 * methods.
 */
export interface BatterySource {
  /**
   * Subscribe to battery-state changes. Returns an unsubscribe function. The
   * listener SHOULD be invoked with the current snapshot soon after subscribing
   * so a late subscriber is not stuck on a stale default.
   */
  subscribe(listener: BatteryListener): () => void;
  /** The current best-known snapshot. */
  getCurrent(): BatteryState;
}

/** The neutral UNKNOWN snapshot used before any data arrives / on the noop. */
export const UNKNOWN_BATTERY_STATE: BatteryState = {
  level: null,
  isCharging: null,
  isLow: false,
};

/**
 * Derive the low-battery flag. Low = a KNOWN level strictly below the threshold
 * AND not provably charging. An unknown level is never "low" (we cannot claim
 * it); a `true` charging state suppresses the warning; an unknown charging
 * state does NOT (warn pessimistically). Exported for boundary unit testing.
 */
export function computeIsLow(
  level: number | null,
  isCharging: boolean | null,
): boolean {
  if (level === null) {
    return false;
  }
  return level < LOW_BATTERY_THRESHOLD && isCharging !== true;
}

/** Assemble a {@link BatteryState} from raw level/charging, deriving `isLow`. */
export function makeBatteryState(
  level: number | null,
  isCharging: boolean | null,
): BatteryState {
  return { level, isCharging, isLow: computeIsLow(level, isCharging) };
}

/**
 * Safe no-op source used when device-info is unavailable (Jest, bare JS, or
 * before the native bridge is linked). It yields the neutral UNKNOWN snapshot,
 * never emits a change, and never throws. Unknown (not 100%) is intentional: a
 * degraded detector must neither raise a false low alarm nor falsely report
 * full.
 */
export const noopBatterySource: BatterySource = {
  subscribe: (listener: BatteryListener) => {
    // Emit the neutral snapshot once so subscribers settle on a value, then
    // never change.
    try {
      listener(UNKNOWN_BATTERY_STATE);
    } catch {
      // A subscriber must never crash the source.
    }
    return () => {};
  },
  getCurrent: () => UNKNOWN_BATTERY_STATE,
};

/**
 * Minimal shape of the `react-native-device-info` surface we consume. The
 * library exposes far more; we read only the battery level + charging fields
 * and treat the rest as opaque so a version bump can't break us.
 *
 * `getBatteryLevel()` resolves to a fraction in `[0, 1]` (or `-1` when unknown).
 * `isBatteryCharging()` resolves to a boolean. `addBatteryLevelListener` and
 * `addPowerStateListener` (when present) push live updates; the power-state
 * payload carries `batteryLevel` (fraction) and `batteryState`
 * (`'charging' | 'full' | 'unplugged' | 'unknown'`).
 */
export interface DeviceInfoLike {
  getBatteryLevel: () => Promise<number>;
  isBatteryCharging: () => Promise<boolean>;
  addBatteryLevelListener?: (
    listener: (payload: { batteryLevel: number }) => void,
  ) => { remove: () => void };
  addPowerStateListener?: (
    listener: (payload: {
      batteryLevel?: number;
      batteryState?: string;
      lowPowerMode?: boolean;
    }) => void,
  ) => { remove: () => void };
}

/**
 * Normalise a device-info battery level onto `[0, 1]` or `null`. device-info
 * returns `-1` for an unknown level; values are otherwise already a fraction.
 * Exported for unit testing.
 */
export function normalizeLevel(raw: number | undefined | null): number | null {
  if (typeof raw !== 'number' || Number.isNaN(raw) || raw < 0) {
    return null;
  }
  // Clamp into [0, 1] defensively; some platforms can momentarily report >1.
  return raw > 1 ? 1 : raw;
}

/**
 * Map a device-info `powerState` payload onto our coarse {@link BatteryState}.
 * `batteryState` is the source of truth for charging; if it is missing/unknown
 * we leave charging `null` (unknown) rather than guessing. Exported for unit
 * testing.
 */
export function mapPowerState(payload: {
  batteryLevel?: number;
  batteryState?: string;
}): BatteryState {
  const level = normalizeLevel(payload.batteryLevel);
  let isCharging: boolean | null;
  switch (payload.batteryState) {
    case 'charging':
    case 'full':
      isCharging = true;
      break;
    case 'unplugged':
      isCharging = false;
      break;
    default:
      // 'unknown' / missing -> we genuinely don't know.
      isCharging = null;
      break;
  }
  return makeBatteryState(level, isCharging);
}

/**
 * Build a BatterySource backed by a device-info-like module. Exported
 * (separately from the factory) so unit tests can drive the mapping/subscription
 * wiring with a fake module WITHOUT touching the native bridge.
 *
 * Any failure degrades gracefully: an unreadable initial fetch keeps the
 * UNKNOWN default; a listener that cannot be attached simply means no live
 * updates (getCurrent still returns the last seeded snapshot).
 */
export function createSourceFromDeviceInfo(
  deviceInfo: DeviceInfoLike,
): BatterySource {
  // Best-known snapshot, seeded UNKNOWN and updated on every event / initial
  // read. getCurrent() reads this synchronously.
  let current: BatteryState = UNKNOWN_BATTERY_STATE;
  // Track the freshest raw level/charging independently so a level-only event
  // and a charging-only event each refine the combined snapshot.
  let lastLevel: number | null = null;
  let lastCharging: boolean | null = null;

  const recompute = () => {
    current = makeBatteryState(lastLevel, lastCharging);
  };

  // Kick off a one-shot read so getCurrent()/late subscribers converge even
  // before the first power-state event. Fire-and-forget; failures keep UNKNOWN.
  try {
    Promise.all([
      deviceInfo.getBatteryLevel(),
      deviceInfo.isBatteryCharging(),
    ])
      .then(([level, charging]) => {
        lastLevel = normalizeLevel(level);
        lastCharging = typeof charging === 'boolean' ? charging : null;
        recompute();
      })
      .catch(() => {
        // Keep the UNKNOWN default on failure.
      });
  } catch {
    // A throwing getter — keep the UNKNOWN default.
  }

  return {
    subscribe: (listener: BatteryListener) => {
      const removers: Array<() => void> = [];

      const emit = () => {
        try {
          listener(current);
        } catch {
          // Isolate a misbehaving subscriber.
        }
      };

      // Prefer the rich power-state listener (level + charging in one payload).
      try {
        if (typeof deviceInfo.addPowerStateListener === 'function') {
          const sub = deviceInfo.addPowerStateListener(payload => {
            const next = mapPowerState(payload);
            // A power-state payload may omit a field; only overwrite what it
            // actually carries so we never clobber a known value with unknown.
            if (next.level !== null) {
              lastLevel = next.level;
            }
            if (next.isCharging !== null) {
              lastCharging = next.isCharging;
            }
            recompute();
            emit();
          });
          removers.push(() => sub.remove());
        } else if (typeof deviceInfo.addBatteryLevelListener === 'function') {
          // Fallback: level-only updates (charging stays at last-known).
          const sub = deviceInfo.addBatteryLevelListener(({ batteryLevel }) => {
            lastLevel = normalizeLevel(batteryLevel);
            recompute();
            emit();
          });
          removers.push(() => sub.remove());
        }
      } catch {
        logger.warn('battery: addPowerStateListener failed — no live updates');
      }

      // Settle the subscriber on the current best-known snapshot immediately.
      emit();

      return () => {
        for (const remove of removers) {
          try {
            remove();
          } catch {
            // never throw on teardown
          }
        }
      };
    },
    getCurrent: () => current,
  };
}

/**
 * Default factory: the real device-info-backed source if the native module is
 * present, else the no-op source. Picking happens lazily here (not at import)
 * so importing this module under Jest does not pull the native side.
 *
 * NOTE: the require/adapter branch is not exercised by the unit suite (it would
 * touch the native module); the unit tests drive {@link createSourceFromDeviceInfo}
 * with a fake module and assert the noop fallback directly.
 */
export function createBatterySource(): BatterySource {
  try {
    // Required lazily and through require() to keep the native module out of
    // the type graph and out of Jest's module load.
    const deviceInfo = require('react-native-device-info').default;
    if (
      !deviceInfo ||
      typeof deviceInfo.getBatteryLevel !== 'function' ||
      typeof deviceInfo.isBatteryCharging !== 'function'
    ) {
      logger.warn('battery: device-info module malformed — using no-op source');
      return noopBatterySource;
    }
    return createSourceFromDeviceInfo(deviceInfo);
  } catch {
    logger.warn('battery: device-info unavailable — using no-op source');
    return noopBatterySource;
  }
}

/**
 * Process-wide shared source. Memoised so every consumer (the hook, future
 * features) subscribes to the SAME source and snapshot rather than each
 * spinning up its own device-info listener.
 */
let sharedSource: BatterySource | null = null;

/** The shared {@link BatterySource}, created on first use. */
export function getBatterySource(): BatterySource {
  if (sharedSource === null) {
    sharedSource = createBatterySource();
  }
  return sharedSource;
}

/**
 * Test seam: override (or reset, with `null`) the shared source. Intended for
 * tests that need to drive charge/charging transitions deterministically.
 */
export function __setBatterySource(source: BatterySource | null): void {
  sharedSource = source;
}
