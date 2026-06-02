/**
 * Tests for the PURE connection-quality mapping (DMY-53).
 *
 * Covers: all four stats-based levels with boundary thresholds for RTT and
 * loss, the worse-of-two combination, the coarse status fallback for EVERY
 * ConnectionStatus value, the getStats-absent / throwing / null paths, and the
 * status-floor cap on stale stats.
 */
import {
  LOSS_THRESHOLDS_PCT,
  QUALITY_LEVEL_ORDER,
  RTT_THRESHOLDS_MS,
  isWarningLevel,
  levelFromStats,
  levelFromStatus,
  resolveConnectionQuality,
  type ConnectionQuality,
  type ConnectionStats,
} from '../connectionQuality';
import type { ConnectionStatus } from '../../../store/types';

const stats = (rttMs: number, packetLossPct: number): ConnectionStats => ({
  rttMs,
  packetLossPct,
});

describe('levelFromStats — RTT thresholds (loss kept excellent)', () => {
  it.each<[number, ConnectionQuality]>([
    [0, 'excellent'],
    [RTT_THRESHOLDS_MS.excellent, 'excellent'], // 150 inclusive
    [RTT_THRESHOLDS_MS.excellent + 1, 'good'], // 151
    [RTT_THRESHOLDS_MS.good, 'good'], // 300 inclusive
    [RTT_THRESHOLDS_MS.good + 1, 'fair'], // 301
    [RTT_THRESHOLDS_MS.fair, 'fair'], // 500 inclusive
    [RTT_THRESHOLDS_MS.fair + 1, 'poor'], // 501
    [5000, 'poor'],
  ])('rtt %ims -> %s', (rttMs, expected) => {
    expect(levelFromStats(stats(rttMs, 0))).toBe(expected);
  });
});

describe('levelFromStats — packet-loss thresholds (rtt kept excellent)', () => {
  it.each<[number, ConnectionQuality]>([
    [0, 'excellent'],
    [LOSS_THRESHOLDS_PCT.excellent, 'excellent'], // 1 inclusive
    [LOSS_THRESHOLDS_PCT.excellent + 0.5, 'good'], // 1.5
    [LOSS_THRESHOLDS_PCT.good, 'good'], // 3 inclusive
    [LOSS_THRESHOLDS_PCT.good + 0.5, 'fair'], // 3.5
    [LOSS_THRESHOLDS_PCT.fair, 'fair'], // 8 inclusive
    [LOSS_THRESHOLDS_PCT.fair + 0.5, 'poor'], // 8.5
    [100, 'poor'],
  ])('loss %f%% -> %s', (lossPct, expected) => {
    expect(levelFromStats(stats(0, lossPct))).toBe(expected);
  });
});

describe('levelFromStats — combination takes the worse axis', () => {
  it('excellent rtt but heavy loss -> poor', () => {
    expect(levelFromStats(stats(10, 20))).toBe('poor');
  });
  it('low loss but very high rtt -> poor', () => {
    expect(levelFromStats(stats(1000, 0))).toBe('poor');
  });
  it('good rtt and fair loss -> fair (worse of the two)', () => {
    expect(levelFromStats(stats(250, 5))).toBe('fair');
  });
  it('both excellent -> excellent', () => {
    expect(levelFromStats(stats(100, 0.5))).toBe('excellent');
  });

  it('clamps NaN / negative samples to 0 (degrades to excellent on that axis)', () => {
    expect(levelFromStats(stats(Number.NaN, 0))).toBe('excellent');
    expect(levelFromStats(stats(-50, -3))).toBe('excellent');
    // A bad rtt axis still lets the loss axis dominate.
    expect(levelFromStats(stats(Number.NaN, 50))).toBe('poor');
  });
});

describe('levelFromStatus — coarse fallback for every ConnectionStatus', () => {
  it.each<[ConnectionStatus, ConnectionQuality]>([
    ['idle', 'fair'],
    ['paired', 'fair'],
    ['connecting', 'fair'],
    ['connected', 'good'],
    ['disconnected', 'poor'],
    ['failed', 'poor'],
  ])('%s -> %s', (status, expected) => {
    expect(levelFromStatus(status)).toBe(expected);
  });

  it('every status maps to a valid level', () => {
    const all: ConnectionStatus[] = [
      'idle',
      'paired',
      'connecting',
      'connected',
      'disconnected',
      'failed',
    ];
    for (const s of all) {
      expect(QUALITY_LEVEL_ORDER).toContain(levelFromStatus(s));
    }
  });
});

describe('resolveConnectionQuality — provider seam', () => {
  it('uses the status fallback when getStats is undefined (DMY-45 absent)', () => {
    expect(resolveConnectionQuality('connected', undefined)).toBe('good');
    expect(resolveConnectionQuality('connecting', undefined)).toBe('fair');
    expect(resolveConnectionQuality('failed', undefined)).toBe('poor');
  });

  it('uses the status fallback when getStats returns null (no sample yet)', () => {
    expect(resolveConnectionQuality('connected', () => null)).toBe('good');
  });

  it('does not crash and falls back when getStats throws', () => {
    const throwing = () => {
      throw new Error('boom');
    };
    expect(() => resolveConnectionQuality('connected', throwing)).not.toThrow();
    expect(resolveConnectionQuality('connected', throwing)).toBe('good');
  });

  it('uses accurate stats when a sample is available on a connected link', () => {
    expect(resolveConnectionQuality('connected', () => stats(100, 0))).toBe(
      'excellent',
    );
    expect(resolveConnectionQuality('connected', () => stats(400, 0))).toBe(
      'fair',
    );
  });

  it('caps stats at the status floor: stale good stats on a dropped link read poor', () => {
    // A torn-down link must not report excellent off a stale low-latency sample.
    expect(resolveConnectionQuality('disconnected', () => stats(50, 0))).toBe(
      'poor',
    );
    expect(resolveConnectionQuality('failed', () => stats(50, 0))).toBe('poor');
  });
});

describe('isWarningLevel', () => {
  it('only the lowest level warrants a warning', () => {
    expect(isWarningLevel('poor')).toBe(true);
    expect(isWarningLevel('fair')).toBe(false);
    expect(isWarningLevel('good')).toBe(false);
    expect(isWarningLevel('excellent')).toBe(false);
  });
});
