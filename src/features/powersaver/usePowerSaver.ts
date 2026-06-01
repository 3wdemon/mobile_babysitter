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
import { useEffect, useRef } from 'react';

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

  // One service per (hook lifetime × backend identity). Rebuilt only when the
  // backend changes so the brightness snapshot / idempotency state is stable
  // across ordinary re-renders.
  const serviceRef = useRef<PowerSaverService | null>(null);
  const backendRef = useRef<PowerSaverBackend | undefined>(backend);
  if (serviceRef.current === null || backendRef.current !== backend) {
    serviceRef.current?.restore();
    serviceRef.current = createPowerSaverService(backend);
    backendRef.current = backend;
  }

  // Drive apply/restore from the (active && enabled) condition. The service is
  // idempotent, so re-running this effect cannot double-apply or double-restore.
  useEffect(() => {
    const service = serviceRef.current;
    if (!service) {
      return;
    }
    if (active && enabled) {
      service.apply();
    } else {
      service.restore();
    }
  }, [active, enabled]);

  // Final safety net: always restore on unmount so brightness/keep-awake never
  // leak past the component. Idempotent, so this is harmless if already restored
  // by the effect above. Separate effect keyed on [] -> runs once at unmount.
  useEffect(() => {
    return () => {
      serviceRef.current?.restore();
    };
  }, []);

  // Derive `active` from the resolved condition (not the service's internal
  // flag): the flag is mutated inside an effect AFTER render, so reading it here
  // would be stale. This value reflects exactly what the effect applies.
  return {
    active: active && enabled,
    enabled,
  };
}
