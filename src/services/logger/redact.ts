import type { RedactOptions } from './types';

/**
 * Default placeholder substituted for redacted values.
 */
export const REDACTED = '[REDACTED]';

const DEFAULT_MAX_DEPTH = 8;

/**
 * Exact sensitive key names (compared case-insensitively).
 *
 * These are matched as whole keys only — e.g. `key` matches the property
 * `key` but NOT `monkey`. This avoids false positives on innocuous keys that
 * happen to contain a sensitive word as a substring.
 */
const EXACT_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'pairingtoken',
  'sdp',
  'candidate',
  'authtoken',
  'token',
  'password',
  'secret',
  'email',
  'key',
  'biometric',
]);

/**
 * Pattern-based sensitive substrings.
 *
 * A key is redacted by pattern only when one of these words appears at a
 * word boundary inside the key — i.e. the key is composed of the word plus
 * non-letter separators or camelCase/PascalCase casing around it.
 *
 * Rationale: matching a raw substring (`'key' in 'monkey'`) produces false
 * positives. Instead we require the sensitive word to be a distinct token:
 *   - `apiSecret`, `api_secret`, `secret-value`, `accessToken`, `userPassword`
 *     -> redacted (word boundary via casing / separator).
 *   - `monkey`, `donkey`, `keyboard`, `tokenizer`, `passwordless` would NOT
 *     match because the sensitive word is not a standalone token.
 *
 * The boundary on each side is one of: string start/end, a non-letter
 * character (digit, _, -, space, etc.), or a lowercase->uppercase camelCase
 * transition.
 */
const PATTERN_WORDS = ['secret', 'token', 'key', 'password'] as const;

const LETTER = /[a-z]/i;

/**
 * Check whether `word` (e.g. 'token') occurs as a distinct token inside `key`.
 *
 * A token boundary on each side is one of:
 *   - start / end of the key,
 *   - a non-letter character (digit, `_`, `-`, space, ...),
 *   - a camelCase transition.
 *
 * Camel boundaries are evaluated against the ORIGINAL casing (not via a
 * case-insensitive regex, whose `[A-Z]`/`[^a-z]` classes misbehave under the
 * `i` flag). Concretely:
 *   - left boundary holds when the preceding char is a non-letter, OR the
 *     match itself begins with an uppercase letter following a lowercase one
 *     (`accessToken` -> `Token`).
 *   - right boundary holds when the following char is a non-letter, an
 *     uppercase letter (start of the next camel token), OR end of string.
 *
 * This rejects substring-only hits such as `monkey`, `keyboard`,
 * `passwordless`, `secretary`, `tokenizer`.
 */
function matchesWordToken(key: string, word: string): boolean {
  const lowerKey = key.toLowerCase();
  let from = 0;
  for (;;) {
    const idx = lowerKey.indexOf(word, from);
    if (idx === -1) {
      return false;
    }
    const end = idx + word.length;

    const prev = idx > 0 ? key[idx - 1] : '';
    const matchFirst = key[idx];
    const next = end < key.length ? key[end] : '';

    // Left boundary: nothing before, a non-letter before, or camelCase
    // (uppercase first char of the match preceded by a lowercase letter).
    const leftOk =
      idx === 0 ||
      !LETTER.test(prev) ||
      (matchFirst === matchFirst.toUpperCase() &&
        matchFirst !== matchFirst.toLowerCase() &&
        prev === prev.toLowerCase() &&
        LETTER.test(prev));

    // Right boundary: nothing after, a non-letter after, or an uppercase
    // letter after (start of the next camelCase token).
    const rightOk =
      end === key.length ||
      !LETTER.test(next) ||
      (next === next.toUpperCase() && next !== next.toLowerCase());

    if (leftOk && rightOk) {
      return true;
    }
    from = idx + 1;
  }
}

/**
 * Decide whether a property key denotes sensitive data.
 *
 * @param key - The object property name.
 * @param extraExactKeys - Optional set of additional exact keys (lowercased).
 */
export function isSensitiveKey(
  key: string,
  extraExactKeys?: ReadonlySet<string>,
): boolean {
  const lower = key.toLowerCase();

  if (EXACT_SENSITIVE_KEYS.has(lower)) {
    return true;
  }
  if (extraExactKeys?.has(lower)) {
    return true;
  }

  // Pattern rules operate on the original key so camelCase boundaries survive.
  for (const word of PATTERN_WORDS) {
    if (matchesWordToken(key, word)) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively redact sensitive values from arbitrary input.
 *
 * Behaviour:
 *  - Primitives (string, number, boolean, bigint, symbol), null and undefined
 *    are returned unchanged — there is no key context to act on.
 *  - Arrays are mapped element-wise (preserving order/length); array elements
 *    have no key, so only nested objects within them get redacted.
 *  - Plain objects / class instances: any property whose key is sensitive
 *    (see {@link isSensitiveKey}) has its value replaced with the placeholder;
 *    other values are redacted recursively.
 *  - Functions are replaced with '[Function]' (avoids leaking closures / noise).
 *  - Circular references are detected via a WeakSet and replaced with
 *    '[Circular]'.
 *  - Recursion beyond `maxDepth` is replaced with '[Object]'.
 *
 * The function is total: it never throws on any input.
 *
 * @returns A redacted deep copy; the original input is not mutated.
 */
export function redact<T = unknown>(value: T, options?: RedactOptions): unknown {
  const placeholder = options?.placeholder ?? REDACTED;
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const extraExactKeys = options?.additionalKeys
    ? new Set(options.additionalKeys.map(k => k.toLowerCase()))
    : undefined;

  const seen = new WeakSet<object>();

  function walk(input: unknown, depth: number): unknown {
    // Primitives / null / undefined: nothing to redact.
    if (input === null || typeof input !== 'object') {
      if (typeof input === 'function') {
        return '[Function]';
      }
      return input;
    }

    if (depth > maxDepth) {
      return '[Object]';
    }

    if (seen.has(input as object)) {
      return '[Circular]';
    }
    seen.add(input as object);

    try {
      if (Array.isArray(input)) {
        return input.map(item => walk(item, depth + 1));
      }

      // Some object-likes (Date, Map, Set, Error, etc.) are best stringified
      // rather than walked. We keep this conservative: Date/RegExp -> string.
      if (input instanceof Date) {
        return input.toISOString();
      }
      if (input instanceof RegExp) {
        return input.toString();
      }

      const out: Record<string, unknown> = {};
      // Own enumerable string keys only (avoids prototype noise / getters that throw).
      for (const key of Object.keys(input as Record<string, unknown>)) {
        let raw: unknown;
        try {
          raw = (input as Record<string, unknown>)[key];
        } catch {
          // Getter threw — skip the value but keep the key visible.
          out[key] = '[Unreadable]';
          continue;
        }
        if (isSensitiveKey(key, extraExactKeys)) {
          out[key] = placeholder;
        } else {
          out[key] = walk(raw, depth + 1);
        }
      }
      return out;
    } catch {
      // Defensive: never throw from redact.
      return '[Unredactable]';
    } finally {
      seen.delete(input as object);
    }
  }

  return walk(value, 0);
}
