/**
 * useConnectionQuality — React binding for the connection-quality level (DMY-53).
 *
 * Resolves the 4-level link quality the parent-unit shows, combining:
 *  - the store's `connectionStatus` (always available), and
 *  - an OPTIONAL, injectable `getStats` provider (RTT/loss). When present it is
 *    POLLED on an interval and the accurate {@link levelFromStats} mapping wins;
 *    when absent the hook degrades to the coarse status-derived level.
 *
 * The polling interval is set up/torn down with `useEffect` so there is no
 * timer leak on unmount or when the provider identity changes — mirroring the
 * subscription discipline in {@link useNetworkStatus} and the discovery hooks.
 * With no provider the hook does no timer work at all and simply tracks status.
 *
 * @param getStats Optional stats provider. Until DMY-45 wires the media
 *   pipeline this is `undefined` and the status fallback is used.
 * @param options.intervalMs Poll cadence when a provider is present (default 2s).
 */
import { useEffect, useState } from 'react';

import {
  resolveConnectionQuality,
  type ConnectionQuality,
  type GetConnectionStats,
} from './connectionQuality';
import { useAppStore } from '../../store/useAppStore';

/** Default poll cadence for stats sampling (ms). */
export const DEFAULT_QUALITY_POLL_MS = 2000;

export interface UseConnectionQualityOptions {
  /** Poll cadence when a `getStats` provider is present. Default 2000ms. */
  readonly intervalMs?: number;
}

export function useConnectionQuality(
  getStats?: GetConnectionStats,
  options: UseConnectionQualityOptions = {},
): ConnectionQuality {
  const { intervalMs = DEFAULT_QUALITY_POLL_MS } = options;

  const status = useAppStore(s => s.connectionStatus);

  // Seed from the status path so the very first render is meaningful even
  // before any stats sample is taken.
  const [level, setLevel] = useState<ConnectionQuality>(() =>
    resolveConnectionQuality(status, getStats),
  );

  useEffect(() => {
    // Recompute immediately so a status change (or a new provider) is reflected
    // without waiting a full interval.
    setLevel(resolveConnectionQuality(status, getStats));

    // No provider: nothing to poll — the status-derived level above is final.
    if (!getStats) {
      return undefined;
    }

    const id = setInterval(() => {
      setLevel(resolveConnectionQuality(status, getStats));
    }, Math.max(1, intervalMs));

    return () => clearInterval(id);
  }, [status, getStats, intervalMs]);

  return level;
}
