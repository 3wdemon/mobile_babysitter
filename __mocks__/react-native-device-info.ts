/**
 * Jest mock for `react-native-device-info` (DMY-54).
 *
 * The real library reads battery/charging through a native module with no JS
 * fallback under Jest. This mock implements only the surface the battery-status
 * service consumes — `getBatteryLevel()`, `isBatteryCharging()` and
 * `addPowerStateListener(listener) => { remove }` — defaulting to a healthy,
 * unplugged state so the app mounts deterministically.
 *
 * Tests can drive transitions with the exported helpers:
 *   - `__emitPowerState(payload)` — push a power-state change to all listeners.
 *   - `__setBattery({ level, charging })` — what the next read resolves to.
 *   - `__reset()` — clear listeners + restore the default healthy state.
 *
 * Note: battery unit tests drive the service seam directly via a fake module;
 * this mock exists so any test that mounts a screen (which builds the real
 * source) does not touch native code.
 */

interface PowerStatePayload {
  batteryLevel?: number;
  batteryState?: string;
  lowPowerMode?: boolean;
}

const DEFAULT_LEVEL = 0.85;
const DEFAULT_CHARGING = false;

let level = DEFAULT_LEVEL;
let charging = DEFAULT_CHARGING;
let listeners: Array<(p: PowerStatePayload) => void> = [];

const getBatteryLevel = jest.fn(() => Promise.resolve(level));
const isBatteryCharging = jest.fn(() => Promise.resolve(charging));

const addPowerStateListener = jest.fn(
  (listener: (p: PowerStatePayload) => void) => {
    listeners.push(listener);
    return {
      remove: () => {
        listeners = listeners.filter(l => l !== listener);
      },
    };
  },
);

/** Test helper: push a power-state change to all current listeners. */
export function __emitPowerState(payload: PowerStatePayload): void {
  if (typeof payload.batteryLevel === 'number') {
    level = payload.batteryLevel;
  }
  if (payload.batteryState === 'charging' || payload.batteryState === 'full') {
    charging = true;
  } else if (payload.batteryState === 'unplugged') {
    charging = false;
  }
  for (const l of listeners) {
    l(payload);
  }
}

/** Test helper: set what the next battery read resolves to. */
export function __setBattery(next: {
  level?: number;
  charging?: boolean;
}): void {
  if (typeof next.level === 'number') {
    level = next.level;
  }
  if (typeof next.charging === 'boolean') {
    charging = next.charging;
  }
}

/** Test helper: clear listeners and restore the default healthy state. */
export function __reset(): void {
  listeners = [];
  level = DEFAULT_LEVEL;
  charging = DEFAULT_CHARGING;
  getBatteryLevel.mockClear();
  isBatteryCharging.mockClear();
  addPowerStateListener.mockClear();
}

export default {
  getBatteryLevel,
  isBatteryCharging,
  addPowerStateListener,
};
