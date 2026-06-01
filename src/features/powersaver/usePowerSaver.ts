/**
 * usePowerSaver — applies the baby-unit power-saver posture during an active
 * monitoring session (DMY-12).
 *
 * Contract:
 *  - When a session is `active` AND power-saver is enabled in settings, the hook
 *    applies the low-power posture (dim + keep-awake + sensors-off) via the
 *    {@link PowerSaverService}.
 *  - When the session ends, power-saver is turned off, or the component
 *    unmounts, the previous (normal) brightness/keep-awake/sensors are restored.
 *  - Restoration on teardown runs EXACTLY ONCE even if multiple deps change.
 *
 * The "active session" is abstracted as a boolean flag here: the real WebRTC
 * session does not exist yet (DMY-16/18). When it lands, the streaming layer
 * simply passes its live/connected state as `active`.
 *
 * The device backend is INJECTED. Production passes a native brightness/
 * keep-awake bridge; tests pass a spy; omitted -> safe no-op (see service). The
 * hook holds ONE service instance for its lifetime so the snapshot survives
 * re-renders and idempotency is preserved.
 */
import { useEffect, useMemo, useRef } from 'react';

import { useAppStore } from '../../store/useAppStore';
import {
  createPowerSaverService,
  PowerSaverService,
} from './powerSaverService';
import type { PowerSaverBackend } from './types';

export interface UsePowerSaverOptions {
  /**
   * Whether a baby-unit monitoring session is currently running. While `true`
   * (and power-saver is enabled) the low-power posture is applied.
   */
  readonly active: boolean;
  /**
   * Device-effect backend. Omit to use the safe no-op (until the native bridge
   * is wired). Changing the backend identity rebuilds the service.
   */
  readonly backend?: PowerSaverBackend;
}

export interface PowerSaverState {
  /** Whether the low-power posture is currently applied. */
  readonly active: boolean;
  /** Whether the user has power-saver enabled in settings. */
  readonly enabled: boolean;
}

export function usePowerSaver(options: UsePowerSaverOptions): PowerSaverState {
  const { active, backend } = options;

  const enabled = useAppStore(s => s.settings.powerSaverEnabled);

  // One service per (hook lifetime × backend identity). `useMemo` is a PURE
  // factory — it only constructs the service, with NO side-effect during render
  // (no restore() here). It is rebuilt only when the backend identity changes so
  // the brightness snapshot / idempotency state is stable across ordinary
  // re-renders. Safe under React StrictMode's double-invoked render.
  const service = useMemo(
    () => createPowerSaverService(backend),
    [backend],
  );

  // Restore the PREVIOUS service when the backend identity changes (so a swapped
  // backend never leaks a dimmed screen / held keep-awake lock). The restore is
  // a side-effect, so it runs in an effect — never during render. On the first
  // render `prevServiceRef` already points at the current service, so this is a
  // no-op until the backend actually changes.
  const prevServiceRef = useRef<PowerSaverService>(service);
  useEffect(() => {
    const previous = prevServiceRef.current;
    if (previous !== service) {
      previous.restore();
      prevServiceRef.current = service;
    }
  }, [service]);

  // Drive apply/restore from the (active && enabled) condition. The service is
  // idempotent, so re-running this effect cannot double-apply or double-restore.
  // Keyed on `service` too: a fresh backend re-applies the posture if still
  // active+enabled.
  useEffect(() => {
    if (active && enabled) {
      service.apply();
    } else {
      service.restore();
    }
  }, [service, active, enabled]);

  // Final safety net: always restore on unmount so brightness/keep-awake never
  // leak past the component. Idempotent, so this is harmless if already restored
  // by the effect above. Keyed on `service` so a swapped backend's predecessor
  // cleanup also runs; the latest service is cleaned up on unmount.
  useEffect(() => {
    return () => {
      service.restore();
    };
  }, [service]);

  // Derive `active` from the resolved condition (not the service's internal
  // flag): the flag is mutated inside an effect AFTER render, so reading it here
  // would be stale. This value reflects exactly what the effect applies.
  return {
    active: active && enabled,
    enabled,
  };
}
