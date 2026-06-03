import { logBuffer } from './logBuffer';
import { redact } from './redact';
import { LOG_LEVEL_WEIGHT, type LogLevel, type RedactOptions } from './types';

/**
 * `__DEV__` is a global injected by the React Native / Metro bundler.
 * It is `true` in development and `false` in release builds. We read it
 * defensively so the module also works under plain Node / Jest where it may
 * be undefined (treated as production -> warn+).
 */
declare const __DEV__: boolean | undefined;

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

/**
 * Minimum level that is emitted given the current environment.
 *  - development (`__DEV__ === true`): debug and above.
 *  - production  (otherwise):          warn and above.
 */
function minLevelWeight(): number {
  return isDev() ? LOG_LEVEL_WEIGHT.debug : LOG_LEVEL_WEIGHT.warn;
}

const CONSOLE_METHOD: Record<LogLevel, 'log' | 'info' | 'warn' | 'error'> = {
  debug: 'log',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

function emit(level: LogLevel, args: unknown[], options?: RedactOptions): void {
  if (LOG_LEVEL_WEIGHT[level] < minLevelWeight()) {
    return;
  }

  let safeArgs: unknown[];
  try {
    safeArgs = args.map(arg => redact(arg, options));
  } catch {
    // redact is already total, but never let logging crash the app.
    safeArgs = ['[log-redaction-failed]'];
  }

  const method = CONSOLE_METHOD[level];
  try {
    (console[method] as (...a: unknown[]) => void)(`[${level.toUpperCase()}]`, ...safeArgs);
  } catch {
    // Swallow any console errors — logging must never throw.
  }

  // In-memory ring-buffer sink (DMY-62). We push the ALREADY-REDACTED args, so
  // the buffer never holds raw SDP / ICE candidates / audio / tokens / PII —
  // even in memory. Wrapped defensively: the buffer must never break logging.
  try {
    logBuffer.push({
      timestamp: Date.now(),
      level,
      message: formatSafeArgs(safeArgs),
    });
  } catch {
    // Buffer is best-effort diagnostics; a failure here is non-fatal.
  }
}

/**
 * Render the already-redacted args into a single, human-readable line for the
 * buffer / export. Strings are kept verbatim; everything else is JSON-stringified
 * (objects were already converted to log-safe plain structures by `redact`).
 * Falls back to `String()` for anything JSON cannot serialise (e.g. BigInt).
 */
function formatSafeArgs(safeArgs: unknown[]): string {
  return safeArgs
    .map(arg => {
      if (typeof arg === 'string') {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

/**
 * Application logger.
 *
 * All arguments are passed through {@link redact} before being written, so
 * sensitive fields (tokens, SDP, credentials, etc.) never reach the console.
 * Output is console-only — the logger performs no network I/O (privacy-first).
 */
export const logger = {
  debug(...args: unknown[]): void {
    emit('debug', args);
  },
  info(...args: unknown[]): void {
    emit('info', args);
  },
  warn(...args: unknown[]): void {
    emit('warn', args);
  },
  error(...args: unknown[]): void {
    emit('error', args);
  },
};

export type Logger = typeof logger;
