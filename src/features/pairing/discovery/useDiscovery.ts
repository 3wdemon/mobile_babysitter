/**
 * useDiscovery — React bindings for mDNS/Bonjour local discovery (DMY-7).
 *
 * Two hooks, one per role, both built on {@link DiscoveryService}:
 *
 *  - {@link useDiscoveredUnits} (parent-unit): starts a LAN browse on mount,
 *    returns the live list of resolved baby-units, and STOPS the browse on
 *    unmount. The list updates as units appear (`resolved`) and disappear
 *    (`removed`).
 *  - {@link usePublishService} (baby-unit): advertises the current session id on
 *    mount (and re-advertises if the session id changes — e.g. "New code"), and
 *    UNPUBLISHES on unmount.
 *
 * The backend is INJECTED. Production passes the real react-native-zeroconf
 * adapter ({@link createZeroconfBackend}); tests pass a fake; omitted → safe
 * no-op (see service). Each hook holds ONE service instance for its lifetime so
 * the list/idempotency state survives re-renders; cleanup runs exactly once on
 * unmount.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  createDiscoveryService,
  createZeroconfBackend,
  DiscoveryService,
} from './discoveryService';
import type { DiscoveredBabyUnit, ZeroconfBackend } from './types';

/**
 * Resolve the backend to use. When the caller passes one (tests, or a future
 * explicit wiring) we use it; otherwise we build the real zeroconf adapter,
 * which itself degrades to a no-op when the native module is unavailable.
 */
function useBackend(injected?: ZeroconfBackend): ZeroconfBackend {
  // Build the real adapter lazily, once, when nothing is injected. The adapter
  // factory is fail-safe (returns a no-op if the native module is missing).
  const fallbackRef = useRef<ZeroconfBackend | null>(null);
  if (injected) {
    return injected;
  }
  if (fallbackRef.current === null) {
    fallbackRef.current = createZeroconfBackend();
  }
  return fallbackRef.current;
}

export interface UseDiscoveredUnitsOptions {
  /** Inject a backend (tests). Omit to use the real zeroconf adapter. */
  readonly backend?: ZeroconfBackend;
  /**
   * Whether browsing is enabled. Defaults to `true`. Set `false` to keep the
   * hook mounted without an active browse (e.g. before the user opts into
   * network discovery).
   */
  readonly enabled?: boolean;
}

export interface UseDiscoveredUnits {
  /** Live list of resolved baby-units on the LAN. */
  readonly units: readonly DiscoveredBabyUnit[];
  /** Whether a browse is currently active. */
  readonly scanning: boolean;
}

/**
 * Parent-unit: browse the LAN for baby-units. Starts on mount (when `enabled`),
 * stops + tears down on unmount.
 */
export function useDiscoveredUnits(
  options: UseDiscoveredUnitsOptions = {},
): UseDiscoveredUnits {
  const { backend: injected, enabled = true } = options;
  const backend = useBackend(injected);

  // One service per (hook lifetime × backend identity).
  const service = useMemo<DiscoveryService>(
    () => createDiscoveryService(backend),
    [backend],
  );

  const [units, setUnits] = useState<readonly DiscoveredBabyUnit[]>(() =>
    service.getUnits(),
  );

  useEffect(() => {
    // subscribe() invokes the listener immediately with the current snapshot.
    const unsubscribe = service.subscribe(setUnits);
    if (enabled) {
      service.startScanning();
    }
    return () => {
      unsubscribe();
      // Stop the browse on unmount/backend-swap. dispose() also removes backend
      // listeners so a swapped backend never leaks subscriptions.
      service.dispose();
    };
  }, [service, enabled]);

  return { units, scanning: service.isScanning };
}

export interface UsePublishServiceOptions {
  /**
   * The pairing session id to advertise. When it changes (e.g. "New code"), the
   * previous advertisement is withdrawn and the new one published.
   */
  readonly sessionId: string;
  /** Inject a backend (tests). Omit to use the real zeroconf adapter. */
  readonly backend?: ZeroconfBackend;
  /**
   * Whether to advertise. Defaults to `true`. Set `false` to stay mounted
   * without advertising (e.g. while the baby-unit is not yet "ready").
   */
  readonly enabled?: boolean;
}

export interface UsePublishService {
  /** Whether a service is currently advertised. */
  readonly publishing: boolean;
}

/**
 * Baby-unit: advertise `sessionId` over mDNS while mounted + enabled. Withdraws
 * on unmount, when disabled, or when the session id changes.
 */
export function usePublishService(
  options: UsePublishServiceOptions,
): UsePublishService {
  const { sessionId, backend: injected, enabled = true } = options;
  const backend = useBackend(injected);

  const service = useMemo<DiscoveryService>(
    () => createDiscoveryService(backend),
    [backend],
  );

  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (enabled && sessionId) {
      service.startPublishing(sessionId);
    } else {
      service.stopPublishing();
    }
    setPublishing(service.isPublishing);
    return () => {
      service.stopPublishing();
    };
  }, [service, sessionId, enabled]);

  // Final teardown when the service (backend) identity changes or on unmount.
  useEffect(() => {
    return () => {
      service.dispose();
    };
  }, [service]);

  return { publishing };
}
