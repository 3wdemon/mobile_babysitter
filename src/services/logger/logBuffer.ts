/**
 * In-memory ring buffer of recent log entries (DMY-62).
 *
 * Backs the Diagnostics screen's log viewer and the redacted export. The buffer
 * is a SINK wired into the logger (see `logger.ts`): every emitted line is
 * pushed here AFTER the logger has already run it through {@link redact}, so the
 * buffer holds no SDP / ICE candidates / audio / tokens / PII — even in memory.
 * Export re-affirms redaction as defence-in-depth (see DiagnosticsScreen).
 *
 * Bounded memory: the buffer is a fixed-capacity ring. Once at capacity, each
 * `push` evicts the oldest entry, so memory stays O(cap) regardless of how long
 * the app runs or how chatty logging is.
 *
 * Pure and unit-testable: no React, no native modules. A tiny subscribe
 * mechanism lets the screen bind via `useSyncExternalStore` with a stable
 * snapshot (the snapshot reference only changes when the contents change).
 */
import type { LogLevel } from './types';

/**
 * A single captured, already-redacted log entry.
 *
 * `message` is the human-readable, redacted line as it was written to the
 * console (level tag stripped). It contains no raw secrets because the logger
 * redacts before pushing here.
 */
export interface LogEntry {
  /** Epoch milliseconds when the entry was captured. */
  readonly timestamp: number;
  /** Severity level. */
  readonly level: LogLevel;
  /** Redacted, rendered message text. */
  readonly message: string;
}

/** Default ring-buffer capacity. Bounds in-memory log retention. */
export const DEFAULT_LOG_BUFFER_CAPACITY = 500;

type Listener = () => void;

/**
 * A fixed-capacity ring buffer of {@link LogEntry}.
 *
 * Entries are stored oldest-first internally; {@link getEntries} returns a
 * NEWEST-FIRST snapshot (what the UI wants). The snapshot is memoised so its
 * reference is stable between mutations — required by `useSyncExternalStore`.
 */
export class LogBuffer {
  private readonly capacity: number;
  private entries: LogEntry[] = [];
  private listeners = new Set<Listener>();
  /** Cached newest-first snapshot; invalidated on every mutation. */
  private snapshot: LogEntry[] | null = null;

  /**
   * @param capacity Maximum retained entries (>= 1). Non-finite / < 1 values
   *   fall back to {@link DEFAULT_LOG_BUFFER_CAPACITY}.
   */
  constructor(capacity: number = DEFAULT_LOG_BUFFER_CAPACITY) {
    this.capacity =
      Number.isFinite(capacity) && capacity >= 1
        ? Math.floor(capacity)
        : DEFAULT_LOG_BUFFER_CAPACITY;
  }

  /** Configured capacity. */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Append an entry, evicting the oldest when at capacity. O(1) amortised.
   */
  push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      // Evict the oldest. `shift` keeps the array length bounded at `capacity`.
      this.entries.shift();
    }
    this.snapshot = null;
    this.emitChange();
  }

  /**
   * Newest-first snapshot of the buffered entries.
   *
   * The returned array is memoised: repeated calls without an intervening
   * mutation return the SAME reference, so `useSyncExternalStore` does not see
   * a phantom change (which would otherwise loop / warn).
   */
  getEntries(): readonly LogEntry[] {
    if (this.snapshot === null) {
      // Copy then reverse so the internal oldest-first store is untouched.
      this.snapshot = this.entries.slice().reverse();
    }
    return this.snapshot;
  }

  /** Current number of buffered entries (<= capacity). */
  size(): number {
    return this.entries.length;
  }

  /** Drop all buffered entries. */
  clear(): void {
    if (this.entries.length === 0) {
      return;
    }
    this.entries = [];
    this.snapshot = null;
    this.emitChange();
  }

  /**
   * Subscribe to mutations. Returns an unsubscribe function. Intended for
   * `useSyncExternalStore`.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A misbehaving subscriber must never break logging.
      }
    }
  }
}

/**
 * Process-wide buffer the logger pushes into and the Diagnostics screen reads.
 * A singleton so all log call sites and the viewer share one ring.
 */
export const logBuffer = new LogBuffer();
