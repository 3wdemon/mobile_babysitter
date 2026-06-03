/**
 * bandwidthSource — a real `getStats`-backed {@link BandwidthSignalSource}
 * (DMY-45, part 3).
 *
 * The adaptive-bitrate logic (DMY-17, useVideoStream) reacts to a coarse
 * {@link BandwidthSignal} (`low` / `ok` / `hold`) from a
 * {@link BandwidthSignalSource}. Until now the only source was a crude
 * connection-state proxy (`disconnected`→low). This module derives the signal
 * from the REAL outbound-RTP stats of the baby-unit's video sender, polled via
 * `RTCPeerConnection.getStats()`:
 *
 *   - **available outgoing bitrate** falling below the current encoder cap → the
 *     link cannot carry what we are sending → `low` (step quality DOWN);
 *   - **packet loss** rising above a threshold across a poll interval → `low`;
 *   - a healthy link (loss low AND headroom available) → `ok` (step UP);
 *   - otherwise `hold` (unknown / transient — do not thrash the encoder).
 *
 * ## Why a polling source behind the existing seam
 * Keeping this behind {@link BandwidthSignalSource} means useVideoStream is
 * UNCHANGED and stays unit-testable with synthetic signals; the native stats API
 * never leaks into the hook. The source itself is testable too: the stats
 * READER is injected ({@link StatsReader}), defaulting to the peer connection's
 * `getStats`, and the poll timer is injectable — so this module is exercised
 * with synthetic stats reports and a fake clock, with NO native dependency.
 *
 * ## Honest boundary
 * Real `getStats` numbers only exist on a device with a live peer connection;
 * whether the encoder actually steps down on a real congested network is a
 * device milestone. The DECISION logic ({@link classifyStats}) and the polling
 * lifecycle are fully covered here against synthetic reports.
 *
 * ## Privacy
 * Stats are coarse transport numbers (bitrate, packet counts) — no PII, no media
 * content. We log only the derived signal, never raw reports.
 */
import { logger } from '../../services/logger';
import type { BandwidthSignal, BandwidthSignalSource } from './videoStream';

/**
 * The slice of `RTCStatsReport` we read. `getStats()` resolves a Map-like of
 * stat objects keyed by id; we only touch `outbound-rtp` (what we are sending)
 * and `candidate-pair` (which carries `availableOutgoingBitrate`). Modelled
 * structurally so a fake report drives the tests.
 */
export interface RtcStatLike {
  readonly type?: string;
  readonly kind?: string;
  /** outbound-rtp: cumulative packets sent. */
  readonly packetsSent?: number;
  /** remote-inbound-rtp / outbound-rtp: cumulative packets lost. */
  readonly packetsLost?: number;
  /** candidate-pair: estimated available send bitrate (bps). */
  readonly availableOutgoingBitrate?: number;
  readonly [key: string]: unknown;
}

/** A `getStats()` report: iterable of stat entries (the native Map is iterable). */
export type RtcStatsReportLike = Iterable<RtcStatLike> | {
  values(): Iterable<RtcStatLike>;
};

/** Reads a fresh stats report. Defaults to the peer connection's `getStats`. */
export type StatsReader = () => Promise<RtcStatsReportLike>;

/** Injectable timer primitives so the poll loop is deterministic in tests. */
export type SetInterval = (handler: () => void, ms: number) => unknown;
export type ClearInterval = (handle: unknown) => void;

/** Options for {@link createGetStatsBandwidthSource}. */
export interface GetStatsBandwidthSourceOptions {
  /** Reads a stats report (injected; defaults to the pc's `getStats`). */
  readonly read: StatsReader;
  /** Poll interval in ms. Defaults to {@link DEFAULT_STATS_POLL_MS}. */
  readonly pollMs?: number;
  /**
   * Packet-loss fraction (lost / sent over an interval) above which we treat the
   * link as constrained. Defaults to {@link DEFAULT_LOSS_THRESHOLD} (2%).
   */
  readonly lossThreshold?: number;
  /**
   * Minimum available outgoing bitrate (bps) below which we shed quality even
   * with low loss (the link estimate collapsed). Defaults to
   * {@link DEFAULT_MIN_BITRATE_BPS}.
   */
  readonly minBitrateBps?: number;
  /** Injected `setInterval`; defaults to the host's. */
  readonly setIntervalFn?: SetInterval;
  /** Injected `clearInterval`; defaults to the host's. */
  readonly clearIntervalFn?: ClearInterval;
}

/** Default poll cadence — frequent enough to react, slow enough not to thrash. */
export const DEFAULT_STATS_POLL_MS = 2000;
/** Default loss fraction threshold (2%). */
export const DEFAULT_LOSS_THRESHOLD = 0.02;
/** Default min available-bitrate floor (250 kbps). */
export const DEFAULT_MIN_BITRATE_BPS = 250_000;

/** A normalised, interval-delta view of the stats we classify on. */
export interface StatsSnapshot {
  /** Cumulative packets sent (outbound video), or null if unknown. */
  readonly packetsSent: number | null;
  /** Cumulative packets lost (outbound video), or null if unknown. */
  readonly packetsLost: number | null;
  /** Available outgoing bitrate in bps from the active candidate pair, or null. */
  readonly availableOutgoingBitrate: number | null;
}

/** Iterate a stats report tolerating either a plain iterable or a Map-like. */
function* iterateReport(report: RtcStatsReportLike): Generator<RtcStatLike> {
  if (typeof (report as { values?: unknown }).values === 'function') {
    yield* (report as { values(): Iterable<RtcStatLike> }).values();
    return;
  }
  yield* report as Iterable<RtcStatLike>;
}

/**
 * Reduce a raw stats report to the {@link StatsSnapshot} we classify on: the
 * outbound video RTP's cumulative packets sent/lost and the active candidate
 * pair's available outgoing bitrate. Missing fields stay `null` so the
 * classifier can hold rather than guess.
 */
export function readSnapshot(report: RtcStatsReportLike): StatsSnapshot {
  let packetsSent: number | null = null;
  let packetsLost: number | null = null;
  let availableOutgoingBitrate: number | null = null;

  for (const stat of iterateReport(report)) {
    const type = stat.type;
    if (type === 'outbound-rtp' && (stat.kind === 'video' || stat.kind === undefined)) {
      if (typeof stat.packetsSent === 'number') {
        packetsSent = stat.packetsSent;
      }
      if (typeof stat.packetsLost === 'number') {
        packetsLost = stat.packetsLost;
      }
    } else if (type === 'remote-inbound-rtp' && stat.kind !== 'audio') {
      // Loss is most reliably reported by the REMOTE inbound report for our
      // outbound stream; prefer it when present.
      if (typeof stat.packetsLost === 'number') {
        packetsLost = stat.packetsLost;
      }
    }
    if (
      type === 'candidate-pair' &&
      typeof stat.availableOutgoingBitrate === 'number'
    ) {
      availableOutgoingBitrate = stat.availableOutgoingBitrate;
    }
  }

  return { packetsSent, packetsLost, availableOutgoingBitrate };
}

/**
 * Classify the link health into a {@link BandwidthSignal} from the delta between
 * two consecutive snapshots (`prev` may be null on the first poll → `hold`).
 *
 *  - loss fraction over the interval ≥ `lossThreshold` → `low`;
 *  - else available outgoing bitrate present AND below `minBitrateBps` → `low`;
 *  - else if we have a usable reading (loss known low, or healthy bitrate) → `ok`;
 *  - else `hold` (nothing actionable this interval).
 */
export function classifyStats(
  prev: StatsSnapshot | null,
  curr: StatsSnapshot,
  lossThreshold: number,
  minBitrateBps: number,
): BandwidthSignal {
  // Packet-loss fraction across the interval (needs two readings).
  if (
    prev &&
    prev.packetsSent !== null &&
    curr.packetsSent !== null &&
    prev.packetsLost !== null &&
    curr.packetsLost !== null
  ) {
    const sentDelta = curr.packetsSent - prev.packetsSent;
    const lostDelta = curr.packetsLost - prev.packetsLost;
    if (sentDelta > 0) {
      const lossFraction = lostDelta / (sentDelta + lostDelta);
      if (lossFraction >= lossThreshold) {
        return 'low';
      }
    }
  }

  // Available outgoing bitrate floor (single reading is enough).
  if (
    curr.availableOutgoingBitrate !== null &&
    curr.availableOutgoingBitrate < minBitrateBps
  ) {
    return 'low';
  }

  // A healthy reading: we have loss data (and it was low above) or a bitrate
  // estimate above the floor → allow stepping UP.
  if (
    curr.availableOutgoingBitrate !== null ||
    (prev && prev.packetsSent !== null && curr.packetsSent !== null)
  ) {
    return 'ok';
  }

  return 'hold';
}

/**
 * Create a {@link BandwidthSignalSource} backed by `getStats` polling.
 *
 * `subscribe` starts a poll loop (one shared loop for all listeners) that reads
 * a fresh stats report every `pollMs`, classifies it against the previous
 * reading, and emits the resulting {@link BandwidthSignal}. The returned
 * unsubscribe removes the listener and stops the loop once the last listener
 * leaves. A failed/throwing `read` emits nothing for that tick (logged coarsely)
 * — the monitor never crashes on a flaky stats call.
 */
export function createGetStatsBandwidthSource(
  options: GetStatsBandwidthSourceOptions,
): BandwidthSignalSource {
  const {
    read,
    pollMs = DEFAULT_STATS_POLL_MS,
    lossThreshold = DEFAULT_LOSS_THRESHOLD,
    minBitrateBps = DEFAULT_MIN_BITRATE_BPS,
    setIntervalFn = (h, ms) => setInterval(h, ms),
    clearIntervalFn = h => clearInterval(h as ReturnType<typeof setInterval>),
  } = options;

  const listeners = new Set<(signal: BandwidthSignal) => void>();
  let prev: StatsSnapshot | null = null;
  let handle: unknown = null;

  function emit(signal: BandwidthSignal): void {
    for (const l of listeners) {
      try {
        l(signal);
      } catch {
        // A listener must never break the poll loop.
      }
    }
  }

  async function poll(): Promise<void> {
    let report: RtcStatsReportLike;
    try {
      report = await read();
    } catch {
      logger.warn('webrtc/bandwidth: getStats read failed; holding');
      return;
    }
    const curr = readSnapshot(report);
    const signal = classifyStats(prev, curr, lossThreshold, minBitrateBps);
    prev = curr;
    // Coarse, non-PII fact only — the derived signal, never raw stats.
    logger.debug('webrtc/bandwidth: signal', { signal });
    if (signal !== 'hold') {
      emit(signal);
    }
  }

  function start(): void {
    if (handle !== null) {
      return;
    }
    prev = null;
    handle = setIntervalFn(() => {
      // poll is total (own try/catch); the catch keeps the promise non-floating.
      poll().catch(() => {});
    }, pollMs);
  }

  function stop(): void {
    if (handle === null) {
      return;
    }
    clearIntervalFn(handle);
    handle = null;
    prev = null;
  }

  return {
    subscribe(listener: (signal: BandwidthSignal) => void): () => void {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop();
        }
      };
    },
  };
}
