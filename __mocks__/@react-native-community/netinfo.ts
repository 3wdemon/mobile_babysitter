/**
 * Jest mock for `@react-native-community/netinfo` (DMY-60).
 *
 * The real library reads connectivity through a native module with no JS
 * fallback under Jest. This mock implements only the surface the network-status
 * service consumes — `addEventListener(listener) => unsubscribe` and
 * `fetch() => Promise<state>` — defaulting to a CONNECTED wifi state so the app
 * mounts "online" deterministically.
 *
 * Tests can drive transitions with the exported helpers:
 *   - `__emit(state)`     — push a state change to all listeners.
 *   - `__setFetch(state)` — what the next `fetch()` resolves to.
 *   - `__reset()`         — clear listeners + restore the connected default.
 *
 * Note: most network unit tests drive the service seam directly via a fake
 * module; this mock exists so any test that mounts a screen (which builds the
 * real source) does not touch native code.
 */

interface NetInfoState {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
  type?: string | null;
}

const CONNECTED: NetInfoState = {
  isConnected: true,
  isInternetReachable: true,
  type: 'wifi',
};

let listeners: Array<(s: NetInfoState) => void> = [];
let fetchState: NetInfoState = { ...CONNECTED };

const addEventListener = jest.fn((listener: (s: NetInfoState) => void) => {
  listeners.push(listener);
  // NetInfo emits the current state to a new subscriber.
  listener(fetchState);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
});

const fetch = jest.fn(() => Promise.resolve(fetchState));

/** Test helper: push a state change to all current listeners. */
export function __emit(state: NetInfoState): void {
  fetchState = state;
  for (const l of listeners) {
    l(state);
  }
}

/** Test helper: set what the next `fetch()` resolves to. */
export function __setFetch(state: NetInfoState): void {
  fetchState = state;
}

/** Test helper: clear listeners and restore the connected default. */
export function __reset(): void {
  listeners = [];
  fetchState = { ...CONNECTED };
  addEventListener.mockClear();
  fetch.mockClear();
}

export default { addEventListener, fetch };
