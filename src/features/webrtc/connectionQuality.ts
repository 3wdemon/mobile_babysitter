/**
 * Connection-quality mapping (DMY-53).
 *
 * The parent-unit shows a 4-level link-quality indicator
 * (`excellent | good | fair | poor`). This module is the PURE, fully
 * unit-testable core of that feature: it owns ONLY the math of turning numbers
 * into a level. It has no React, no timers and no WebRTC dependency.
 *
 * Two independent sources feed the level, in priority order:
 *
 *  1. REAL transport stats (`getStats` -> RTT + packet-loss). When the full
 *     media pipeline (DMY-45) is wired, the parent can sample
 *     `RTCPeerConnection.getStats()` and reduce it to {@link ConnectionStats}.
 *     {@link levelFromStats} maps those numbers onto a level via documented
 *     thresholds. This is the accurate path.
 *
 *  2. COARSE fallback from {@link ConnectionStatus}. DMY-45 is NOT merged yet,
 *     so `getStats` may be entirely absent. In that case we degrade gracefully:
 *     {@link levelFromStatus} maps the store's connection status onto a coarse
 *     level so the indicator is still meaningful (and never crashes) without
 *     any numeric stats.
 *
 * The `getStats` seam is deliberately INJECTABLE and may be `undefined` — see
 * {@link GetConnectionStats}. This mirrors the project's other seams
 * (`NetworkSource`, discovery) where a provider can be absent and the code
 * degrades rather than throwing.
 */
import type { ConnectionStatus } from '../../store/types';

/**
 * The four indicator levels, best -> worst. Ordered so `QUALITY_LEVEL_ORDER`
 * (below) can rank/compare them.
 */
export type ConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor';

/**
 * Worst-to-best is the natural severity order; this array is best-to-worst so
 * index 0 is the healthiest. Used for comparisons and exhaustive iteration in
 * tests/UI.
 */
export const QUALITY_LEVEL_ORDER: readonly ConnectionQuality[] = [
  'excellent',
  'good',
  'fair',
  'poor',
] as const;

/**
 * Minimal transport stats the level mapping needs. A consumer reduces a full
 * `RTCStatsReport` (DMY-45) to this shape. Both fields are "lower is better".
 */
export interface ConnectionStats {
  /** Round-trip time in milliseconds (current/last sample). */
  readonly rttMs: number;
  /** Packet loss as a percentage in [0, 100]. */
  readonly packetLossPct: number;
}

/**
 * Injectable stats provider. Returns the latest {@link ConnectionStats}, or
 * `null` when stats are momentarily unavailable (e.g. not connected yet).
 *
 * MAY be `undefined` at the call site entirely: until DMY-45 wires the media
 * pipeline there is no real `getStats`, and the indicator must fall back to the
 * status-derived level. Both "function absent" and "function returns null" are
 * first-class, non-crashing paths.
 */
export type GetConnectionStats = () => ConnectionStats | null;

/**
 * RTT thresholds (ms), inclusive upper bounds per level. Tuned for a real-time
 * audio/video baby monitor where latency is felt directly:
 *  - <= 150ms   excellent — imperceptible.
 *  - <= 300ms   good      — fine for monitoring.
 *  - <= 500ms   fair      — noticeable lag but usable.
 *  - >  500ms   poor.
 */
export const RTT_THRESHOLDS_MS = {
  excellent: 150,
  good: 300,
  fair: 500,
} as const;

/**
 * Packet-loss thresholds (%), inclusive upper bounds per level:
 *  - <= 1%   excellent.
 *  - <= 3%   good.
 *  - <= 8%   fair.
 *  - >  8%   poor.
 */
export const LOSS_THRESHOLDS_PCT = {
  excellent: 1,
  good: 3,
  fair: 8,
} as const;

/** Rank a level by severity (0 = best). Lower is healthier. */
function rank(level: ConnectionQuality): number {
  return QUALITY_LEVEL_ORDER.indexOf(level);
}

/** The WORSE (higher-ranked) of two levels. */
function worse(a: ConnectionQuality, b: ConnectionQuality): ConnectionQuality {
  return rank(a) >= rank(b) ? a : b;
}

/** Map a single RTT sample (ms) onto a level. */
function levelFromRtt(rttMs: number): ConnectionQuality {
  if (rttMs <= RTT_THRESHOLDS_MS.excellent) {
    return 'excellent';
  }
  if (rttMs <= RTT_THRESHOLDS_MS.good) {
    return 'good';
  }
  if (rttMs <= RTT_THRESHOLDS_MS.fair) {
    return 'fair';
  }
  return 'poor';
}

/** Map a single packet-loss sample (%) onto a level. */
function levelFromLoss(packetLossPct: number): ConnectionQuality {
  if (packetLossPct <= LOSS_THRESHOLDS_PCT.excellent) {
    return 'excellent';
  }
  if (packetLossPct <= LOSS_THRESHOLDS_PCT.good) {
    return 'good';
  }
  if (packetLossPct <= LOSS_THRESHOLDS_PCT.fair) {
    return 'fair';
  }
  return 'poor';
}

/**
 * Map transport stats onto a quality level.
 *
 * Latency and loss are combined by taking the WORSE of the two sub-levels: a
 * link is only as good as its weakest dimension (low RTT but heavy loss still
 * stutters audio, and vice-versa). Negative/NaN inputs are clamped to 0 so a
 * malformed sample degrades to "excellent" on that axis rather than throwing —
 * the other axis still applies, and the status fallback covers true outages.
 */
export function levelFromStats(stats: ConnectionStats): ConnectionQuality {
  const rttMs = Number.isFinite(stats.rttMs) ? Math.max(0, stats.rttMs) : 0;
  const lossPct = Number.isFinite(stats.packetLossPct)
    ? Math.max(0, stats.packetLossPct)
    : 0;
  return worse(levelFromRtt(rttMs), levelFromLoss(lossPct));
}

/**
 * Coarse fallback: map the store's {@link ConnectionStatus} onto a level when
 * no numeric stats are available.
 *
 * The store enum is `idle | paired | connecting | connected | disconnected |
 * failed`. Without stats we cannot distinguish excellent/good/fair on a live
 * link, so a healthy `connected` is reported optimistically as `good` (not
 * `excellent`, which we reserve for measured-low-latency links). Everything
 * pre-connection is `fair` (a hopeful "establishing"), and a dropped/failed
 * link is `poor`.
 */
export function levelFromStatus(status: ConnectionStatus): ConnectionQuality {
  switch (status) {
    case 'connected':
      return 'good';
    case 'idle':
    case 'paired':
    case 'connecting':
      return 'fair';
    case 'disconnected':
    case 'failed':
      return 'poor';
    default:
      // Exhaustive: any future status defaults to the safe coarse middle.
      return 'fair';
  }
}

/**
 * Resolve the indicator level from whatever signal is available.
 *
 * Priority:
 *  1. If a `getStats` provider is supplied AND returns a sample, TRUST the
 *     accurate {@link levelFromStats} for a live link — EXCEPT when the status
 *     says the link is down (`disconnected`/`failed`): a torn-down link is
 *     `poor` regardless of any stale stats sample that still looks fine.
 *  2. Otherwise fall back to {@link levelFromStatus}.
 *
 * Note the asymmetry: a healthy `connected` link is NOT capped at the coarse
 * `good` floor — that floor exists only for the no-stats path, and real stats
 * are allowed to read `excellent`. Only terminal statuses force `poor`.
 *
 * Never throws: a throwing/absent provider degrades to the status path.
 */
export function resolveConnectionQuality(
  status: ConnectionStatus,
  getStats?: GetConnectionStats,
): ConnectionQuality {
  const statusLevel = levelFromStatus(status);

  if (!getStats) {
    return statusLevel;
  }

  let sample: ConnectionStats | null = null;
  try {
    sample = getStats();
  } catch {
    sample = null;
  }

  if (!sample) {
    return statusLevel;
  }

  // A torn-down link can't read better than "poor" off a stale sample.
  if (status === 'disconnected' || status === 'failed') {
    return 'poor';
  }

  // Live link: trust the measured stats (may read up to "excellent").
  return levelFromStats(sample);
}

/**
 * Whether a level warrants a non-blocking warning affordance (lowest level).
 * The UI uses this to surface a quiet warning without interrupting monitoring.
 */
export function isWarningLevel(level: ConnectionQuality): boolean {
  return level === 'poor';
}
