/**
 * Logger types for the Mobile Babysitter logging service.
 *
 * Privacy-first: logs are emitted to the console only. The logger never
 * performs any network I/O, so sensitive data redaction is a defence-in-depth
 * measure for local debug output, crash console capture and screen recordings.
 *
 * Redaction model (see `redact`):
 *  - Primarily **key-based**: properties whose name denotes a secret are masked.
 *  - Plus a small **value-level** pass over strings for high-confidence inline
 *    patterns (`Bearer <token>`, `token=...`, `password=...`, etc.).
 *  - It is intentionally NOT a general secret scanner: opaque high-entropy
 *    values with no recognised key/pattern are not detected. Known limitation,
 *    acceptable because the logger is console-only and offline.
 */

/**
 * Severity levels, ordered from least to most severe.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Numeric weight per level used for threshold comparison.
 */
export const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Options controlling redaction behaviour.
 */
export interface RedactOptions {
  /**
   * Placeholder substituted for redacted values.
   * @default '[REDACTED]'
   */
  placeholder?: string;
  /**
   * Extra exact key names (case-insensitive) to treat as sensitive,
   * in addition to the built-in list.
   */
  additionalKeys?: string[];
  /**
   * Maximum recursion depth. Guards against pathological / deeply nested
   * structures. Beyond this depth values are replaced with '[Object]'.
   * @default 8
   */
  maxDepth?: number;
}
