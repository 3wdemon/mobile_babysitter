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
  // All-lowercase concatenations have no camelCase/separator boundary, so the
  // pattern matcher (correctly) rejects them to avoid `monkey`-style false
  // positives. These two are common literal JSON/env key spellings, so we list
  // them explicitly to close the leak. (`apiKey`/`API_KEY`/`apiToken` etc. are
  // already caught by the boundary matcher.)
  'apikey',
  'apitoken',
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

function isUpper(ch: string): boolean {
  return LETTER.test(ch) && ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

/**
 * Check whether `word` (e.g. 'token') occurs as a distinct token inside `key`.
 *
 * A token boundary on each side is one of:
 *   - start / end of the key,
 *   - a non-letter character (digit, `_`, `-`, space, ...),
 *   - a camelCase transition,
 *   - an all-caps acronym -> word transition (`APIKey` -> `Key`,
 *     `SDPKey`, `XToken`).
 *
 * Camel boundaries are evaluated against the ORIGINAL casing (not via a
 * case-insensitive regex, whose `[A-Z]`/`[^a-z]` classes misbehave under the
 * `i` flag). Concretely:
 *   - left boundary holds when the preceding char is a non-letter, OR the
 *     match begins with an uppercase letter and the preceding char is also a
 *     letter (covers both `accessToken` -> `Token` after a lowercase, and the
 *     acronym case `APIKey` -> `Key` after an uppercase). A lowercase-starting
 *     match preceded by a letter (`monkey`) is rejected.
 *   - right boundary holds when the following char is a non-letter, an
 *     uppercase letter (start of the next camel token), OR end of string.
 *
 * This rejects substring-only hits such as `monkey`, `keyboard`,
 * `passwordless`, `secretary`, `tokenizer` while accepting acronym-prefixed
 * tokens such as `APIKey`, `APIToken`, `SDPKey`, `OAuthKey`, `XToken`.
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

    // Left boundary: nothing before, a non-letter before, or a camelCase /
    // acronym transition. The transition holds when the match starts with an
    // uppercase letter (`Token`/`Key`) regardless of whether the preceding
    // letter is lower- (`accessToken`) or upper-case (`APIKey`). A
    // lowercase-starting match preceded by a letter (`monkey`) is NOT a
    // boundary.
    const leftOk = idx === 0 || !LETTER.test(prev) || isUpper(matchFirst);

    // Right boundary: nothing after, a non-letter after, or an uppercase
    // letter after (start of the next camelCase token). A lowercase letter
    // after (`tokenizer`) is NOT a boundary.
    const rightOk = end === key.length || !LETTER.test(next) || isUpper(next);

    if (leftOk && rightOk) {
      return true;
    }
    from = idx + 1;
  }
}

/**
 * Value-level redaction for sensitive patterns embedded inside strings.
 *
 * Key-based redaction cannot catch secrets that live *inside* a string value
 * (e.g. a top-level `'pairingToken=abc'`, a `Bearer <jwt>` header, or a URL
 * query string). This pass redacts a deliberately small, high-confidence set
 * of patterns without attempting to be a general secret scanner:
 *
 *   - `Bearer <token>` (Authorization header style) -> `Bearer [REDACTED]`.
 *   - `(token|password|secret|key|...)=<value>` pairs as found in query
 *     strings / form bodies -> `<name>=[REDACTED]`. The value runs up to the
 *     next `&`, whitespace, `#` or `;`.
 *
 * Anything more (entropy heuristics, JWT shape detection, etc.) is out of
 * scope — see the module/`redact` JSDoc.
 */
const BEARER_RE = /\b(Bearer\s+)\S+/gi;

const KV_SENSITIVE_NAMES =
  'pairingtoken|authtoken|token|password|passwd|pwd|secret|apikey|api_key|key|candidate|sdp';
// Matches `name=value` where name is sensitive. Value = up to a delimiter.
const KV_RE = new RegExp(
  `\\b(${KV_SENSITIVE_NAMES})(=)([^&\\s#;]+)`,
  'gi',
);

export function redactString(text: string, placeholder: string): string {
  let out = text.replace(BEARER_RE, (_m, prefix: string) => `${prefix}${placeholder}`);
  out = out.replace(KV_RE, (_m, name: string, eq: string) => `${name}${eq}${placeholder}`);
  return out;
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
 * Recursively build a redacted, log-safe representation of arbitrary input.
 *
 * This is NOT a faithful deep clone: exotic objects (Map, Set, Error, Date,
 * RegExp) are converted into plain log-friendly structures, and sensitive
 * fields are replaced with the placeholder. The output is intended purely for
 * console diagnostics.
 *
 * Behaviour:
 *  - Strings: passed through {@link redactString} so inline secrets
 *    (`Bearer <jwt>`, `token=...`, `password=...`) are masked even with no key
 *    context. Other primitives (number, boolean, bigint, symbol), null and
 *    undefined are returned unchanged.
 *  - Arrays are mapped element-wise (preserving order/length).
 *  - Plain objects / class instances: any property whose key is sensitive
 *    (see {@link isSensitiveKey}) has its value replaced with the placeholder;
 *    other values are redacted recursively. Both own enumerable **string** and
 *    **symbol** keys are inspected (a symbol's `description` is run through
 *    {@link isSensitiveKey}).
 *  - `Map`: serialised to a plain object `{ '<key>': <value> }`. String keys
 *    are checked with {@link isSensitiveKey}; values are redacted recursively.
 *    This prevents Maps from silently collapsing to `{}` and leaking nothing —
 *    or, worse, being passed to a downstream serialiser that *does* expose them.
 *  - `Set`: serialised to an array of recursively-redacted elements.
 *  - `Error`: serialised to `{ name, message, stack }` with `message`/`stack`
 *    run through value-level redaction (these are non-enumerable and would
 *    otherwise be lost — the primary `logger.error` case).
 *  - Functions are replaced with '[Function]' (avoids leaking closures / noise).
 *  - `Date` -> ISO string, `RegExp` -> source string.
 *  - Circular references are detected via a WeakSet and replaced with
 *    '[Circular]'.
 *  - Recursion beyond `maxDepth` is replaced with '[Object]'.
 *
 * Scope note: redaction is primarily key-based, with a small value-level pass
 * for high-confidence inline patterns. It is defence-in-depth, not a complete
 * secret scanner.
 *
 * The function is total: it never throws on any input. The original input is
 * never mutated.
 */
export function redact<T = unknown>(value: T, options?: RedactOptions): unknown {
  const placeholder = options?.placeholder ?? REDACTED;
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const extraExactKeys = options?.additionalKeys
    ? new Set(options.additionalKeys.map(k => k.toLowerCase()))
    : undefined;

  const seen = new WeakSet<object>();

  function walk(input: unknown, depth: number): unknown {
    // Primitives / null / undefined: only strings carry inline secrets.
    if (input === null || typeof input !== 'object') {
      if (typeof input === 'function') {
        return '[Function]';
      }
      if (typeof input === 'string') {
        return redactString(input, placeholder);
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

      if (input instanceof Date) {
        return input.toISOString();
      }
      if (input instanceof RegExp) {
        return input.toString();
      }

      // Error: name/message/stack are non-enumerable and would be lost by a
      // plain key walk. Serialise them explicitly (the primary logger.error
      // case), redacting inline secrets in the text fields.
      if (input instanceof Error) {
        const err: Record<string, unknown> = {
          name: input.name,
          message: redactString(input.message, placeholder),
        };
        if (typeof input.stack === 'string') {
          err.stack = redactString(input.stack, placeholder);
        }
        // Preserve any custom enumerable own props (redacted).
        for (const key of Object.keys(input as object)) {
          if (key === 'name' || key === 'message' || key === 'stack') {
            continue;
          }
          err[key] = isSensitiveKey(key, extraExactKeys)
            ? placeholder
            : walk((input as unknown as Record<string, unknown>)[key], depth + 1);
        }
        return err;
      }

      // Map: serialise to a plain object so entries are neither lost (Object.keys
      // on a Map is []) nor passed unredacted to a downstream serialiser. String
      // keys go through isSensitiveKey; non-string keys are stringified for the
      // log representation.
      if (input instanceof Map) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of input.entries()) {
          const keyStr = typeof k === 'string' ? k : String(k);
          if (typeof k === 'string' && isSensitiveKey(k, extraExactKeys)) {
            out[keyStr] = placeholder;
          } else {
            out[keyStr] = walk(v, depth + 1);
          }
        }
        return out;
      }

      // Set: serialise to an array of recursively-redacted elements.
      if (input instanceof Set) {
        const arr: unknown[] = [];
        for (const item of input.values()) {
          arr.push(walk(item, depth + 1));
        }
        return arr;
      }

      const out: Record<string, unknown> = {};

      // Own enumerable string keys (avoids prototype noise / getters that throw).
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

      // Own symbol keys: a sensitive symbol description must not leak. Symbol
      // keys are rendered via String(sym) (e.g. 'Symbol(authToken)') so they
      // appear in the log output without colliding with string keys.
      for (const sym of Object.getOwnPropertySymbols(input as object)) {
        const desc = (input as { propertyIsEnumerable(s: symbol): boolean })
          .propertyIsEnumerable(sym);
        if (!desc) {
          continue;
        }
        const outKey = String(sym);
        let raw: unknown;
        try {
          raw = (input as Record<symbol, unknown>)[sym];
        } catch {
          out[outKey] = '[Unreadable]';
          continue;
        }
        const symName = sym.description ?? '';
        if (symName && isSensitiveKey(symName, extraExactKeys)) {
          out[outKey] = placeholder;
        } else {
          out[outKey] = walk(raw, depth + 1);
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
