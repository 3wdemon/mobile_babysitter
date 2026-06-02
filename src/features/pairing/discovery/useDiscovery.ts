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

/**
 * Grace period (ms) after a browse starts before it is considered "settled".
 * mDNS resolution is not instantaneous, so until this elapses an empty list
 * means "still looking" (loading) rather than "nothing on the network"
 * (empty). The first resolved unit also settles the scan immediately. (DMY-59)
 */
export const DISCOVERY_SETTLE_MS = 2500;

export interface UseDiscoveredUnitsOptions {
  /** Inject a backend (tests). Omit to use the real zeroconf adapter. */
  readonly backend?: ZeroconfBackend;
  /**
   * Whether browsing is enabled. Defaults to `true`. Set `false` to keep the
   * hook mounted without an active browse (e.g. before the user opts into
   * network discovery).
   */
  readonly enabled?: boolean;
  /**
   * Grace period (ms) before an empty browse is treated as settled. Defaults to
   * {@link DISCOVERY_SETTLE_MS}. Exposed mainly so tests can shorten it.
   */
  readonly settleMs?: number;
}

export interface UseDiscoveredUnits {
  /** Live list of resolved baby-units on the LAN. */
  readonly units: readonly DiscoveredBabyUnit[];
  /** Whether a browse is currently active. */
  readonly scanning: boolean;
  /**
   * Whether the browse has settled: either at least one unit has resolved, or
   * the grace period has elapsed. Drives the loading-vs-empty decision —
   * `scanning && !settled` is "loading", `settled && units.length === 0` is
   * "nothing found". Always `false` while disabled (no browse in progress).
   */
  readonly settled: boolean;
}

/**
 * Parent-unit: browse the LAN for baby-units. Starts on mount (when `enabled`),
 * stops + tears down on unmount.
 */
export function useDiscoveredUnits(
  options: UseDiscoveredUnitsOptions = {},
): UseDiscoveredUnits {
  const {
    backend: injected,
    enabled = true,
    settleMs = DISCOVERY_SETTLE_MS,
  } = options;
  const backend = useBackend(injected);

  // One service per (hook lifetime × backend identity).
  const service = useMemo<DiscoveryService>(
    () => createDiscoveryService(backend),
    [backend],
  );

  const [units, setUnits] = useState<readonly DiscoveredBabyUnit[]>(() =>
    service.getUnits(),
  );

  // The browse has "settled" once the grace timer elapses or a unit resolves.
  // Until then an empty list is "still looking", not "nothing found" (DMY-59).
  const [graceElapsed, setGraceElapsed] = useState(false);

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

  // Restart the grace window whenever a fresh browse begins.
  useEffect(() => {
    setGraceElapsed(false);
    if (!enabled) {
      return;
    }
    const timer = setTimeout(() => setGraceElapsed(true), settleMs);
    return () => clearTimeout(timer);
  }, [service, enabled, settleMs]);

  // Settled: a unit resolved (we have a result), or the grace window elapsed.
  // Never settled while disabled — there is no browse to settle.
  const settled = enabled && (units.length > 0 || graceElapsed);

  return { units, scanning: service.isScanning, settled };
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
