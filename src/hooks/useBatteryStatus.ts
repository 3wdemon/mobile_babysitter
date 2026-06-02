/**
 * useBatteryStatus — React binding for the shared {@link BatterySource} (DMY-54).
 *
 * Subscribes to the process-wide battery source via `useSyncExternalStore`
 * (consistent with {@link useNetworkStatus}) and returns the current
 * {@link BatteryState}. Defaults to the neutral UNKNOWN snapshot: before any
 * data arrives, when the device-info module is unavailable (Jest / bare JS), or
 * if the source misbehaves, the hook reports unknown so the baby-unit UI shows a
 * neutral state rather than a false low-battery alarm or a fake full charge. The
 * subscription is cleaned up on unmount.
 *
 * @param source Optional explicit source (mainly for tests). Defaults to the
 *   shared source from {@link getBatterySource}.
 */
import { useMemo, useSyncExternalStore } from 'react';

import {
  UNKNOWN_BATTERY_STATE,
  getBatterySource,
  type BatterySource,
  type BatteryState,
} from '../features/powersaver/batteryStatus';

export function useBatteryStatus(source?: BatterySource): BatteryState {
  // Resolve the source once per (optional) argument identity so we don't
  // re-subscribe on every render. The shared source is itself memoised.
  const resolved = useMemo(() => source ?? getBatterySource(), [source]);

  const subscribe = useMemo(
    () => (onStoreChange: () => void) => {
      let last: BatteryState | null = null;
      // The source pushes full BatteryState snapshots; useSyncExternalStore
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
    () => (): BatteryState => {
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
const bridge = new WeakMap<BatterySource, () => BatteryState | null>();

/** getCurrent() guarded so a throwing source degrades to the UNKNOWN state. */
function safeGetCurrent(source: BatterySource): BatteryState {
  try {
    return source.getCurrent();
  } catch {
    return UNKNOWN_BATTERY_STATE;
  }
}
