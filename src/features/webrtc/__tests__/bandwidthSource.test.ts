/**
 * Unit tests for the getStats-backed bandwidth source (DMY-45, part 3).
 *
 * Covers the pure classifier (loss + available-bitrate → low/ok/hold), the
 * snapshot reader (tolerating Map-like + plain-iterable reports), and the
 * polling source lifecycle against an injected clock + synthetic reports.
 */
import {
  classifyStats,
  createGetStatsBandwidthSource,
  readSnapshot,
  DEFAULT_LOSS_THRESHOLD,
  DEFAULT_MIN_BITRATE_BPS,
} from '../bandwidthSource';
import type { RtcStatLike, StatsSnapshot } from '../bandwidthSource';
import type { BandwidthSignal } from '../videoStream';

function snap(p: Partial<StatsSnapshot>): StatsSnapshot {
  return {
    packetsSent: p.packetsSent ?? null,
    packetsLost: p.packetsLost ?? null,
    availableOutgoingBitrate: p.availableOutgoingBitrate ?? null,
  };
}

describe('readSnapshot', () => {
  it('reads outbound-rtp packets + candidate-pair bitrate from a Map-like report', () => {
    const report = new Map<string, RtcStatLike>([
      ['o', { type: 'outbound-rtp', kind: 'video', packetsSent: 1000, packetsLost: 5 }],
      ['cp', { type: 'candidate-pair', availableOutgoingBitrate: 1_500_000 }],
    ]);
    expect(readSnapshot(report)).toEqual({
      packetsSent: 1000,
      packetsLost: 5,
      availableOutgoingBitrate: 1_500_000,
    });
  });

  it('prefers remote-inbound-rtp packetsLost when present', () => {
    const report: RtcStatLike[] = [
      { type: 'outbound-rtp', kind: 'video', packetsSent: 1000, packetsLost: 1 },
      { type: 'remote-inbound-rtp', kind: 'video', packetsLost: 42 },
    ];
    expect(readSnapshot(report).packetsLost).toBe(42);
  });

  it('leaves unknown fields null', () => {
    expect(readSnapshot([])).toEqual({
      packetsSent: null,
      packetsLost: null,
      availableOutgoingBitrate: null,
    });
  });
});

describe('classifyStats', () => {
  const loss = DEFAULT_LOSS_THRESHOLD;
  const floor = DEFAULT_MIN_BITRATE_BPS;

  it('holds on the first reading (no prev)', () => {
    expect(
      classifyStats(null, snap({ packetsSent: 100, packetsLost: 0 }), loss, floor),
    ).toBe('hold');
  });

  it('returns low when packet loss over the interval exceeds the threshold', () => {
    const prev = snap({ packetsSent: 1000, packetsLost: 0 });
    // 50 lost / (950 sent + 50 lost) = 5% > 2%.
    const curr = snap({ packetsSent: 1950, packetsLost: 50 });
    expect(classifyStats(prev, curr, loss, floor)).toBe('low');
  });

  it('returns ok when loss is low across the interval', () => {
    const prev = snap({ packetsSent: 1000, packetsLost: 0 });
    const curr = snap({ packetsSent: 2000, packetsLost: 1 });
    expect(classifyStats(prev, curr, loss, floor)).toBe('ok');
  });

  it('returns low when available outgoing bitrate is below the floor', () => {
    const curr = snap({ availableOutgoingBitrate: floor - 1 });
    expect(classifyStats(null, curr, loss, floor)).toBe('low');
  });

  it('returns ok when available outgoing bitrate is healthy', () => {
    const curr = snap({ availableOutgoingBitrate: floor * 4 });
    expect(classifyStats(null, curr, loss, floor)).toBe('ok');
  });

  it('holds when there is nothing actionable', () => {
    // prev with no packet data, curr with no bitrate and no second reading.
    expect(classifyStats(snap({}), snap({}), loss, floor)).toBe('hold');
  });
});

describe('createGetStatsBandwidthSource', () => {
  function fakeClock() {
    let cb: (() => void) | null = null;
    return {
      setIntervalFn: (handler: () => void) => {
        cb = handler;
        return 1;
      },
      clearIntervalFn: () => {
        cb = null;
      },
      tick: () => cb?.(),
      isRunning: () => cb !== null,
    };
  }

  it('polls, classifies and emits non-hold signals on each tick', async () => {
    const clock = fakeClock();
    const reports: RtcStatLike[][] = [
      // 1st poll: healthy bitrate → ok
      [{ type: 'candidate-pair', availableOutgoingBitrate: 2_000_000 }],
      // 2nd poll: collapsed bitrate → low
      [{ type: 'candidate-pair', availableOutgoingBitrate: 100_000 }],
    ];
    let i = 0;
    const source = createGetStatsBandwidthSource({
      read: async () => reports[Math.min(i++, reports.length - 1)],
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    const signals: BandwidthSignal[] = [];
    const off = source.subscribe(s => signals.push(s));

    clock.tick();
    await Promise.resolve();
    await Promise.resolve();
    clock.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(signals).toEqual(['ok', 'low']);
    off();
    expect(clock.isRunning()).toBe(false);
  });

  it('stops the poll loop when the last listener unsubscribes', () => {
    const clock = fakeClock();
    const source = createGetStatsBandwidthSource({
      read: async () => [],
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });
    const off1 = source.subscribe(() => {});
    const off2 = source.subscribe(() => {});
    expect(clock.isRunning()).toBe(true);
    off1();
    expect(clock.isRunning()).toBe(true); // one listener remains
    off2();
    expect(clock.isRunning()).toBe(false);
  });

  it('holds (emits nothing) when the stats read throws', async () => {
    const clock = fakeClock();
    const source = createGetStatsBandwidthSource({
      read: async () => {
        throw new Error('getStats boom');
      },
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });
    const signals: BandwidthSignal[] = [];
    source.subscribe(s => signals.push(s));
    clock.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(signals).toHaveLength(0);
  });

  it('does not emit a hold signal', async () => {
    const clock = fakeClock();
    const source = createGetStatsBandwidthSource({
      read: async () => [], // empty → hold
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });
    const signals: BandwidthSignal[] = [];
    source.subscribe(s => signals.push(s));
    clock.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(signals).toHaveLength(0);
  });
});
