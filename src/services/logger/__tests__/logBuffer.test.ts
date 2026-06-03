/**
 * Unit tests for the in-memory log ring buffer (DMY-62).
 *
 * Covers: push, newest-first snapshot order, eviction at capacity (bounded
 * memory), snapshot stability for useSyncExternalStore, subscribe/notify, and
 * the capacity guard.
 */
import {
  LogBuffer,
  DEFAULT_LOG_BUFFER_CAPACITY,
  type LogEntry,
} from '../logBuffer';

function entry(message: string, ts: number): LogEntry {
  return { timestamp: ts, level: 'info', message };
}

describe('LogBuffer', () => {
  it('returns entries newest-first', () => {
    const buf = new LogBuffer(10);
    buf.push(entry('first', 1));
    buf.push(entry('second', 2));
    buf.push(entry('third', 3));

    const out = buf.getEntries();
    expect(out.map(e => e.message)).toEqual(['third', 'second', 'first']);
  });

  it('evicts the oldest entries once at capacity (bounded memory)', () => {
    const buf = new LogBuffer(3);
    for (let i = 1; i <= 6; i++) {
      buf.push(entry(`m${i}`, i));
    }
    // Only the last 3 survive; length never exceeds capacity.
    expect(buf.size()).toBe(3);
    expect(buf.getEntries().map(e => e.message)).toEqual(['m6', 'm5', 'm4']);
  });

  it('keeps memory bounded under heavy churn', () => {
    const buf = new LogBuffer(50);
    for (let i = 0; i < 100_000; i++) {
      buf.push(entry(`m${i}`, i));
    }
    expect(buf.size()).toBe(50);
    expect(buf.getEntries()).toHaveLength(50);
    // Newest preserved.
    expect(buf.getEntries()[0].message).toBe('m99999');
  });

  it('returns a stable snapshot reference between mutations', () => {
    const buf = new LogBuffer(10);
    buf.push(entry('a', 1));
    const snap1 = buf.getEntries();
    const snap2 = buf.getEntries();
    expect(snap2).toBe(snap1);

    buf.push(entry('b', 2));
    const snap3 = buf.getEntries();
    expect(snap3).not.toBe(snap1);
  });

  it('notifies subscribers on push and clear, and stops after unsubscribe', () => {
    const buf = new LogBuffer(10);
    const listener = jest.fn();
    const unsubscribe = buf.subscribe(listener);

    buf.push(entry('a', 1));
    expect(listener).toHaveBeenCalledTimes(1);

    buf.clear();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    buf.push(entry('b', 2));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify on clear when already empty', () => {
    const buf = new LogBuffer(10);
    const listener = jest.fn();
    buf.subscribe(listener);
    buf.clear();
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not let a throwing subscriber break logging', () => {
    const buf = new LogBuffer(10);
    buf.subscribe(() => {
      throw new Error('boom');
    });
    expect(() => buf.push(entry('a', 1))).not.toThrow();
    expect(buf.size()).toBe(1);
  });

  it('falls back to the default capacity for invalid values', () => {
    expect(new LogBuffer(0).getCapacity()).toBe(DEFAULT_LOG_BUFFER_CAPACITY);
    expect(new LogBuffer(-5).getCapacity()).toBe(DEFAULT_LOG_BUFFER_CAPACITY);
    expect(new LogBuffer(Number.NaN).getCapacity()).toBe(
      DEFAULT_LOG_BUFFER_CAPACITY,
    );
    expect(new LogBuffer(Infinity).getCapacity()).toBe(
      DEFAULT_LOG_BUFFER_CAPACITY,
    );
  });

  it('floors a fractional capacity', () => {
    expect(new LogBuffer(3.9).getCapacity()).toBe(3);
  });

  it('clear empties the buffer', () => {
    const buf = new LogBuffer(10);
    buf.push(entry('a', 1));
    buf.push(entry('b', 2));
    buf.clear();
    expect(buf.size()).toBe(0);
    expect(buf.getEntries()).toEqual([]);
  });
});
