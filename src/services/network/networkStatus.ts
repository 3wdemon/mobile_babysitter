/**
 * networkStatus — device network-reachability detection behind a seam (DMY-60).
 *
 * The app is P2P-only (no cloud): both phones must share a working local
 * network for the monitor to function, so "are we even on a network?" is a
 * first-class, surfaced signal — not an afterthought. This module owns ONLY the
 * small, testable contract; the actual reachability data is whatever
 * {@link NetworkSource} is injected.
 *
 * ## Design boundary (HONEST)
 * `NetworkState` deliberately exposes a COARSE pair: `isOnline` (does the device
 * have a usable connection?) + `type` (`'wifi' | 'cellular' | …` or `null`).
 * That is all the offline indicator and other features need today; richer
 * details (SSID, IP, strength) are intentionally out of scope here and never
 * left the device anyway. A "usable connection" means connected AND — when the
 * platform reports it — internet-reachable; an unknown reachability is treated
 * optimistically as online so we never flash a false "offline" banner on a LAN
 * that has no internet (a valid P2P setup).
 *
 * ## Source selection (Jest / missing-module safe)
 * The default source ({@link createNetworkSource}) adapts
 * `@react-native-community/netinfo`. Under Jest / bare JS / before the native
 * module is linked it transparently falls back to {@link noopNetworkSource},
 * which assumes ONLINE and never throws — the same "fail safe" posture as the
 * discovery (zeroconf) and powersaver seams. Assuming online on the noop path
 * is deliberate: a degraded detector must never block the monitor by claiming
 * the device is offline.
 *
 * ## Privacy
 * Only the coarse `isOnline`/`type` pair is read; no SSID/IP/PII is touched or
 * logged. Failures degrade silently to the optimistic noop source.
 */
import { logger } from '../logger';

/** Coarse, UI-facing snapshot of device network reachability. */
export interface NetworkState {
  /** Whether the device has a usable connection (see module doc for "usable"). */
  readonly isOnline: boolean;
  /**
   * Coarse connection type as reported by the platform (e.g. `'wifi'`,
   * `'cellular'`, `'ethernet'`, `'none'`, `'unknown'`), or `null` when unknown.
   */
  readonly type: string | null;
}

/** Listener notified whenever the network state changes. */
export type NetworkListener = (state: NetworkState) => void;

/**
 * The seam. A source can be subscribed to (returns an unsubscribe) and can be
 * polled for its current snapshot. Implementations must NEVER throw from these
 * methods.
 */
export interface NetworkSource {
  /**
   * Subscribe to network-state changes. Returns an unsubscribe function. The
   * listener SHOULD be invoked with the current snapshot soon after subscribing
   * so a late subscriber is not stuck on a stale default.
   */
  subscribe(listener: NetworkListener): () => void;
  /** The current best-known snapshot. */
  getCurrent(): NetworkState;
}

/** The optimistic default snapshot used before any data arrives. */
export const ONLINE_STATE: NetworkState = { isOnline: true, type: null };

/**
 * Safe no-op source used when NetInfo is unavailable (Jest, bare JS, or before
 * the native bridge is linked). It assumes ONLINE, never emits a change, and
 * never throws. Assuming online is intentional: a degraded detector must not
 * block the P2P monitor by reporting a false offline.
 */
export const noopNetworkSource: NetworkSource = {
  subscribe: (listener: NetworkListener) => {
    // Emit the optimistic snapshot once so subscribers settle on a value, then
    // never change.
    try {
      listener(ONLINE_STATE);
    } catch {
      // A subscriber must never crash the source.
    }
    return () => {};
  },
  getCurrent: () => ONLINE_STATE,
};

/**
 * Minimal shape of the `@react-native-community/netinfo` state we consume. The
 * library exposes much more; we read only the coarse fields and treat the rest
 * as opaque so a version bump can't break us.
 */
interface NetInfoLikeState {
  readonly isConnected: boolean | null;
  readonly isInternetReachable?: boolean | null;
  readonly type?: string | null;
}

/**
 * Map a NetInfo state onto our coarse {@link NetworkState}.
 *
 * `isOnline` = connected AND (internet reachable OR reachability unknown). The
 * "unknown ⇒ online" rule keeps a LAN-only (no-internet) network — a perfectly
 * valid P2P setup — from being flagged offline. Exported for unit testing.
 */
export function mapNetInfoState(state: NetInfoLikeState): NetworkState {
  const connected = state.isConnected === true;
  const reachable = state.isInternetReachable;
  // null/undefined reachability is "unknown" -> stay optimistic.
  const isOnline = connected && reachable !== false;
  const type = typeof state.type === 'string' ? state.type : null;
  return { isOnline, type };
}

/**
 * Build a NetworkSource backed by a NetInfo-like module. Exported (separately
 * from the factory) so unit tests can drive the mapping/subscription wiring
 * with a fake module WITHOUT touching the native bridge.
 *
 * The module is expected to expose `addEventListener(listener) => unsubscribe`
 * and `fetch() => Promise<state>` (the NetInfo API). Any failure degrades to
 * {@link noopNetworkSource}.
 */
export function createSourceFromNetInfo(netInfo: {
  addEventListener: (l: (s: NetInfoLikeState) => void) => () => void;
  fetch: () => Promise<NetInfoLikeState>;
}): NetworkSource {
  // Best-known snapshot, seeded optimistically and updated on every event /
  // initial fetch. getCurrent() reads this synchronously.
  let current: NetworkState = ONLINE_STATE;

  // Kick off a one-shot fetch so getCurrent()/late subscribers converge even
  // before the first change event. Fire-and-forget; failures are swallowed.
  try {
    netInfo
      .fetch()
      .then(s => {
        current = mapNetInfoState(s);
      })
      .catch(() => {
        // Keep the optimistic default on failure.
      });
  } catch {
    // fetch() threw synchronously — keep the optimistic default.
  }

  return {
    subscribe: (listener: NetworkListener) => {
      let unsubscribe = () => {};
      try {
        unsubscribe = netInfo.addEventListener((s: NetInfoLikeState) => {
          current = mapNetInfoState(s);
          try {
            listener(current);
          } catch {
            // Isolate a misbehaving subscriber.
          }
        });
      } catch {
        logger.warn('network: addEventListener failed — assuming online');
      }
      // Settle the subscriber on the current best-known snapshot immediately.
      try {
        listener(current);
      } catch {
        // ignore
      }
      return () => {
        try {
          unsubscribe();
        } catch {
          // never throw on teardown
        }
      };
    },
    getCurrent: () => current,
  };
}

/**
 * Default factory: the real NetInfo-backed source if the native module is
 * present, else the no-op source. Picking happens lazily here (not at import)
 * so importing this module under Jest does not pull the native side.
 *
 * NOTE: the require/adapter branch is not exercised by the unit suite (it would
 * touch the native module); the unit tests drive {@link createSourceFromNetInfo}
 * with a fake module and assert the noop fallback directly.
 */
export function createNetworkSource(): NetworkSource {
  try {
    // Required lazily and through require() to keep the native module out of
    // the type graph and out of Jest's module load.
    const netInfo = require('@react-native-community/netinfo').default;
    if (
      !netInfo ||
      typeof netInfo.addEventListener !== 'function' ||
      typeof netInfo.fetch !== 'function'
    ) {
      logger.warn('network: NetInfo module malformed — using no-op source');
      return noopNetworkSource;
    }
    return createSourceFromNetInfo(netInfo);
  } catch {
    logger.warn('network: NetInfo unavailable — using no-op source');
    return noopNetworkSource;
  }
}

/**
 * Process-wide shared source. Memoised so every consumer (the hook, future
 * features) subscribes to the SAME source and snapshot rather than each
 * spinning up its own NetInfo listener.
 */
let sharedSource: NetworkSource | null = null;

/** The shared {@link NetworkSource}, created on first use. */
export function getNetworkSource(): NetworkSource {
  if (sharedSource === null) {
    sharedSource = createNetworkSource();
  }
  return sharedSource;
}

/**
 * Test seam: override (or reset, with `null`) the shared source. Intended for
 * tests that need to drive online↔offline transitions deterministically.
 */
export function __setNetworkSource(source: NetworkSource | null): void {
  sharedSource = source;
}
