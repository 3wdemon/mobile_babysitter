/**
 * useNetworkStatus — React binding for the shared {@link NetworkSource} (DMY-60).
 *
 * Subscribes to the process-wide network source via `useSyncExternalStore`
 * (consistent with {@link useTranslation}) and returns the current
 * {@link NetworkState}. Defaults to ONLINE: before any data arrives, when the
 * NetInfo module is unavailable (Jest / bare JS), or if the source misbehaves,
 * the hook reports online so the P2P monitor is never blocked by a false
 * offline. The subscription is cleaned up on unmount.
 *
 * @param source Optional explicit source (mainly for tests). Defaults to the
 *   shared source from {@link getNetworkSource}.
 */
import { useMemo, useSyncExternalStore } from 'react';

import {
  ONLINE_STATE,
  getNetworkSource,
  type NetworkSource,
  type NetworkState,
} from '../services/network';

export function useNetworkStatus(source?: NetworkSource): NetworkState {
  // Resolve the source once per (optional) argument identity so we don't
  // re-subscribe on every render. The shared source is itself memoised.
  const resolved = useMemo(() => source ?? getNetworkSource(), [source]);

  const subscribe = useMemo(
    () => (onStoreChange: () => void) => {
      let last: NetworkState | null = null;
      // The source pushes full NetworkState snapshots; useSyncExternalStore
      // wants a bare "something changed" callback. Bridge by caching the last
      // snapshot for getSnapshot and signalling React on each emission.
      const unsubscribe = resolved.subscribe(state => {
        last = state;
        onStoreChange();
      });
      // Stash the bridge so getSnapshot can read the freshest pushed value
      // while still falling back to the source's own getCurrent().
      bridge.set(resolved, () => last);
      return () => {
        bridge.delete(resolved);
        unsubscribe();
      };
    },
    [resolved],
  );

  const getSnapshot = useMemo(
    () => (): NetworkState => {
      const pushed = bridge.get(resolved)?.();
      return pushed ?? safeGetCurrent(resolved);
    },
    [resolved],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Per-source cache of the last pushed snapshot getter. Lets getSnapshot return
 * a reference-stable value between emissions (useSyncExternalStore requires
 * getSnapshot to be stable across calls when nothing changed).
 */
const bridge = new WeakMap<NetworkSource, () => NetworkState | null>();

/** getCurrent() guarded so a throwing source degrades to ONLINE. */
function safeGetCurrent(source: NetworkSource): NetworkState {
  try {
    return source.getCurrent();
  } catch {
    return ONLINE_STATE;
  }
}
