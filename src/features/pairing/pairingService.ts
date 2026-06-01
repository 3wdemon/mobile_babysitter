/**
 * pairingService — session-id generation and QR payload (de)serialization (DMY-6).
 *
 * Pure, side-effect-free helpers used by the baby-unit to build the QR payload.
 * No cloud, no network: the session id is generated locally with a
 * cryptographically-strong RNG, and the payload is serialized to a compact JSON
 * string suitable for a QR code.
 *
 * ## Random source
 * `crypto.getRandomValues` is the platform-standard CSPRNG. React Native does
 * not expose it natively, so `react-native-get-random-values` polyfills it onto
 * the global `crypto` object (imported for its side-effect at app entry — see
 * `index.js`). We build a RFC-4122 v4 UUID from 16 random bytes ourselves
 * rather than pull in the `uuid` package: it is a few lines, avoids an extra
 * dependency, and keeps the entropy source explicit and auditable. We FAIL
 * CLOSED — if no CSPRNG is available we throw rather than fall back to
 * `Math.random` (which is not cryptographically strong).
 */
import {
  PAIRING_PAYLOAD_TTL_MS,
  PAIRING_PAYLOAD_VERSION,
  PAIRING_TYPE,
} from './types';
import type {
  PairingConnectionInfo,
  PairingPayload,
  PairingScanResult,
} from './types';

/**
 * Fill `bytes` with cryptographically-strong random data via the global
 * `crypto.getRandomValues`. Throws if no CSPRNG is available (fail closed).
 */
/**
 * Minimal structural type for the subset of the WebCrypto API we depend on.
 * Declared locally because the RN tsconfig does not pull in the DOM `Crypto`
 * lib; `react-native-get-random-values` polyfills exactly this shape.
 */
interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

function getRandomBytes(length: number): Uint8Array {
  const cryptoObj = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error(
      'pairing: no cryptographically-strong RNG available ' +
        '(is react-native-get-random-values imported at app entry?)',
    );
  }
  const bytes = new Uint8Array(length);
  cryptoObj.getRandomValues(bytes);
  return bytes;
}

const HEX = '0123456789abcdef';

// Bitwise ops below are intrinsic to RFC-4122 byte/nibble manipulation; the
// generic no-bitwise lint rule does not apply to this low-level encoding.
/* eslint-disable no-bitwise */
function toHex(byte: number): string {
  return HEX[(byte >> 4) & 0x0f] + HEX[byte & 0x0f];
}

/**
 * Generate a cryptographically-random RFC-4122 version-4 UUID.
 *
 * Layout (per RFC 4122 §4.4): 122 random bits, with the version nibble set to
 * `4` and the two most-significant variant bits set to `10`.
 */
export function generateSessionId(): string {
  const b = getRandomBytes(16);
  // Version 4: high nibble of byte 6 must be 0100.
  b[6] = (b[6] & 0x0f) | 0x40;
  // Variant 10xx: high bits of byte 8.
  b[8] = (b[8] & 0x3f) | 0x80;
  /* eslint-enable no-bitwise */

  const hex = Array.from(b, toHex);
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

/** Strict UUID v4 matcher (lower-case hex, correct version/variant nibbles). */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Whether `value` is a well-formed UUID v4 string. */
export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_RE.test(value);
}

/**
 * Build a fresh {@link PairingPayload} for the current pairing attempt.
 *
 * @param connection Optional WebRTC connection info. Omitted in DMY-6 (WebRTC
 *   not yet implemented); the signalling issues will pass it in.
 * @param now Injectable clock (epoch ms) for deterministic tests. Defaults to
 *   `Date.now()`.
 */
export function createPairingPayload(
  connection?: PairingConnectionInfo,
  now: number = Date.now(),
): PairingPayload {
  return {
    type: PAIRING_TYPE,
    version: PAIRING_PAYLOAD_VERSION,
    sessionId: generateSessionId(),
    createdAt: now,
    ...(connection ? { connection } : {}),
  };
}

/**
 * Serialize a payload to the compact string encoded into the QR.
 *
 * JSON is used (not a bespoke binary format): the payload is tiny, JSON is
 * trivially forward/backward compatible as the schema grows, and a QR code
 * comfortably holds it. No whitespace is emitted to keep the QR dense.
 */
export function serializePairingPayload(payload: PairingPayload): string {
  return JSON.stringify(payload);
}

/** Whether `value` is a non-null, non-array plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Defensively validate and normalise a candidate `connection` block (DMY-14).
 *
 * `connection` is OPTIONAL and every field is a placeholder until WebRTC lands
 * (DMY-16/18), but a scanned QR is untrusted input: we must not pass an
 * arbitrary object straight through into app state. Returns:
 *  - `undefined` — no `connection` present (the common DMY-6 case), OR a
 *    present-but-empty/over-pruned block (nothing usable survived). Treated as
 *    "not yet negotiated".
 *  - a `PairingConnectionInfo` — built field-by-field, keeping ONLY the
 *    expected, correctly-typed fields and dropping anything unrecognised.
 *  - `null` — the block is present but malformed (e.g. `sdp` is a number,
 *    `iceCandidates` is not an array of strings, `discovery` is not an object).
 *    The caller rejects the whole payload, since a baby-unit speaking our
 *    schema would never emit a mis-typed connection block — a mis-typed one is
 *    a corrupt or foreign QR.
 */
function validateConnection(
  raw: unknown,
): PairingConnectionInfo | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isPlainObject(raw)) {
    return null;
  }

  const out: {
    sdp?: string;
    iceCandidates?: string[];
    discovery?: { serviceName?: string; port?: number };
  } = {};

  if ('sdp' in raw && raw.sdp !== undefined) {
    if (typeof raw.sdp !== 'string') {
      return null;
    }
    out.sdp = raw.sdp;
  }

  if ('iceCandidates' in raw && raw.iceCandidates !== undefined) {
    if (
      !Array.isArray(raw.iceCandidates) ||
      !raw.iceCandidates.every(c => typeof c === 'string')
    ) {
      return null;
    }
    out.iceCandidates = raw.iceCandidates as string[];
  }

  if ('discovery' in raw && raw.discovery !== undefined) {
    if (!isPlainObject(raw.discovery)) {
      return null;
    }
    const disc = raw.discovery;
    const discOut: { serviceName?: string; port?: number } = {};
    if ('serviceName' in disc && disc.serviceName !== undefined) {
      if (typeof disc.serviceName !== 'string') {
        return null;
      }
      discOut.serviceName = disc.serviceName;
    }
    if ('port' in disc && disc.port !== undefined) {
      if (typeof disc.port !== 'number' || !Number.isFinite(disc.port)) {
        return null;
      }
      discOut.port = disc.port;
    }
    if (Object.keys(discOut).length > 0) {
      out.discovery = discOut;
    }
  }

  // All recognised fields were absent/empty -> nothing to carry; treat as
  // "no connection" rather than an empty object so consumers gate uniformly.
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parse and validate a scanned QR string back into a {@link PairingPayload}.
 *
 * Returns `null` (never throws) for any input that is not a well-formed payload
 * from THIS app: malformed JSON, wrong `type`, unknown/missing `version`,
 * invalid `sessionId`, a missing/invalid `createdAt`, or a malformed
 * `connection` block. This is the contract the parent-unit scanner (DMY-14)
 * relies on to reject foreign or corrupt QRs.
 *
 * Note: this does NOT check freshness — a payload from an old session still
 * parses. The scanner layers {@link isPairingPayloadFresh} on top so the two
 * concerns (well-formed vs. recent) can be surfaced to the user separately.
 */
export function parsePairingPayload(raw: string): PairingPayload | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const obj = data as Record<string, unknown>;

  if (obj.type !== PAIRING_TYPE) {
    return null;
  }
  if (obj.version !== PAIRING_PAYLOAD_VERSION) {
    return null;
  }
  if (!isValidSessionId(obj.sessionId)) {
    return null;
  }
  if (typeof obj.createdAt !== 'number' || !Number.isFinite(obj.createdAt)) {
    return null;
  }

  // Defensively validate the optional connection block: a malformed one means
  // the QR is not a genuine, current-schema pairing code -> reject entirely.
  const connection = validateConnection(obj.connection);
  if (connection === null) {
    return null;
  }

  const payload: PairingPayload = {
    type: PAIRING_TYPE,
    version: PAIRING_PAYLOAD_VERSION,
    sessionId: obj.sessionId,
    createdAt: obj.createdAt,
    ...(connection ? { connection } : {}),
  };

  return payload;
}

/**
 * Whether a parsed payload is FRESH — generated within `maxAgeMs` of `now`
 * (DMY-14).
 *
 * A pairing QR is single-use and short-lived; an old one (e.g. a screenshot, or
 * a code left on screen from a previous session) must be rejected even though
 * it still parses. Kept SEPARATE from {@link parsePairingPayload} so the
 * baby-unit generation path (DMY-6) — which never time-checks its own freshly
 * minted payload — is unaffected.
 *
 * Fail-closed on a future timestamp: a `createdAt` meaningfully ahead of `now`
 * (allowing a small clock-skew grace) is treated as NOT fresh, since a
 * legitimately-generated QR cannot come from the future.
 *
 * @param payload   The parsed payload.
 * @param now       Injectable clock (epoch ms). Defaults to `Date.now()`.
 * @param maxAgeMs  Freshness window. Defaults to {@link PAIRING_PAYLOAD_TTL_MS}.
 */
export function isPairingPayloadFresh(
  payload: PairingPayload,
  now: number = Date.now(),
  maxAgeMs: number = PAIRING_PAYLOAD_TTL_MS,
): boolean {
  const age = now - payload.createdAt;
  // Allow a small future grace for benign clock skew between the two phones.
  const FUTURE_SKEW_GRACE_MS = 60 * 1000;
  if (age < -FUTURE_SKEW_GRACE_MS) {
    return false;
  }
  return age <= maxAgeMs;
}

/**
 * Parse AND freshness-check a scanned QR string in one step (DMY-14).
 *
 * The single entry point the parent-unit scanner uses per scanned frame. Never
 * throws; returns a discriminated {@link PairingScanResult} so the UI can tell
 * "not our QR / corrupt" (`invalid`) apart from "an old QR" (`stale`).
 *
 * @param raw       The decoded QR string.
 * @param now       Injectable clock (epoch ms). Defaults to `Date.now()`.
 * @param maxAgeMs  Freshness window. Defaults to {@link PAIRING_PAYLOAD_TTL_MS}.
 */
export function validateScannedPayload(
  raw: string,
  now: number = Date.now(),
  maxAgeMs: number = PAIRING_PAYLOAD_TTL_MS,
): PairingScanResult {
  const payload = parsePairingPayload(raw);
  if (payload === null) {
    return { ok: false, reason: 'invalid' };
  }
  if (!isPairingPayloadFresh(payload, now, maxAgeMs)) {
    return { ok: false, reason: 'stale' };
  }
  return { ok: true, payload };
}
