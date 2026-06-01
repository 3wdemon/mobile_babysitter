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
import { PAIRING_PAYLOAD_VERSION, PAIRING_TYPE } from './types';
import type {
  PairingConnectionInfo,
  PairingPayload,
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

/**
 * Parse and validate a scanned QR string back into a {@link PairingPayload}.
 *
 * Returns `null` (never throws) for any input that is not a well-formed payload
 * from THIS app: malformed JSON, wrong `type`, unknown/missing `version`,
 * invalid `sessionId`, or a missing/invalid `createdAt`. This is the contract
 * the parent-unit scanner (DMY-7) relies on to reject foreign or corrupt QRs.
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

  const payload: PairingPayload = {
    type: PAIRING_TYPE,
    version: PAIRING_PAYLOAD_VERSION,
    sessionId: obj.sessionId,
    createdAt: obj.createdAt,
  };

  // `connection` is optional and all its fields are placeholders; carry it
  // through verbatim when present and shaped like an object.
  if (typeof obj.connection === 'object' && obj.connection !== null) {
    return { ...payload, connection: obj.connection as PairingConnectionInfo };
  }

  return payload;
}
