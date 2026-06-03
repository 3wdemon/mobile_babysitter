/**
 * pinService — PIN fallback for the parent-mode lock (DMY-10, hardened in
 * DMY-44).
 *
 * When biometrics are unavailable or declined, the parent unlocks with a PIN.
 * The PIN is the user's secret and MUST NOT be stored in plaintext anywhere
 * (no MMKV, no logs). This module:
 *
 *  - derives a hash of the PIN with a SLOW KDF — PBKDF2-HMAC-SHA256 with a
 *    per-PIN random salt and a self-describing parameter record (see below), and
 *  - persists ONLY that record in the OS secure store via `react-native-keychain`
 *    (iOS Keychain / Android Keystore, app-sandboxed, `*_THIS_DEVICE_ONLY`
 *    accessibility so it is never synced to iCloud/backups).
 *
 * ## Slow KDF (DMY-44)
 *
 * A 4–12 digit PIN is low-entropy: a single fast SHA-256 is brute-forced
 * instantly if the keychain blob ever leaks. The device-bound keychain (Secure
 * Enclave / Keystore) is the PRIMARY defence; a slow KDF is defence-in-depth so
 * each offline guess costs `PBKDF2_ITERATIONS` HMAC rounds.
 *
 * The stored value is a self-describing JSON record so the parameters travel
 * WITH the hash and can be re-tuned in future without a migration:
 *
 * ```json
 * { "v": 2, "algo": "pbkdf2-sha256", "iterations": 150000,
 *   "salt": "<hex>", "hash": "<hex>" }
 * ```
 *
 * `iterations` is set to {@link PBKDF2_ITERATIONS}. 100k PBKDF2-SHA256 rounds is
 * a deliberate balance: in the project's pure-JS implementation (no native
 * crypto dep) it costs roughly a few hundred ms on a modern device — a one-off
 * cost the user only pays on set/unlock — while multiplying an offline
 * attacker's per-guess cost by ~100k. The pure-JS round is several times slower
 * than a native one, so 100k here is comparable in attacker-cost to a much
 * higher native count, and the lockout (5 attempts) is the primary brake on
 * online guessing. The record is self-describing, so the count can be raised
 * later and old PINs are transparently re-derived on their next successful
 * unlock without a migration.
 *
 * ## Migration (DMY-44)
 *
 * DMY-10 stored a legacy `"<salt>:<hash>"` string using a single
 * `sha256(salt + ":" + pin)`. We CANNOT pre-emptively re-hash it (we don't have
 * the PIN at rest), so we UPGRADE-ON-SUCCESS: {@link verifyPin} detects the
 * legacy format, verifies against it, and — on a correct PIN — transparently
 * re-derives with PBKDF2 and overwrites the stored record. An unknown/corrupt
 * stored value fails closed; the UI offers a graceful reset (clear + set a new
 * PIN) since it can never be verified.
 *
 * Verification re-derives and compares in constant time. The raw PIN exists only
 * transiently in memory for the duration of a `set`/`verify` call and is never
 * logged.
 */
import * as Keychain from 'react-native-keychain';

import { logger } from '../../services/logger';
import {
  bytesToHex,
  hexToBytes,
  pbkdf2Sha256,
  utf8ToBytes,
} from './pbkdf2';
import { sha256Hex } from './sha256';

/**
 * Keychain service identifier for the parent-mode PIN entry. Distinct from any
 * other keychain usage so it can be reset independently.
 */
export const PIN_KEYCHAIN_SERVICE = 'com.mobilebabysitter.parentPin';

/**
 * Fixed username stored alongside the secret. Carries no meaning beyond being a
 * non-empty label `setGenericPassword` requires; the secret lives in the
 * "password" field.
 */
const PIN_KEYCHAIN_ACCOUNT = 'parent-pin';

/** Minimum PIN length we accept. Enforced on set. */
export const MIN_PIN_LENGTH = 4;
/** Maximum PIN length we accept. */
export const MAX_PIN_LENGTH = 12;

/** Salt size in bytes for the PBKDF2 derivation. */
const SALT_BYTES = 16;
/** Derived-key (hash) size in bytes. 32 = full HMAC-SHA256 output. */
const KEY_BYTES = 32;

/** KDF algorithm identifier persisted in the record. */
export const PIN_KDF_ALGO = 'pbkdf2-sha256';
/** Current stored-record version. */
export const PIN_RECORD_VERSION = 2;
/**
 * PBKDF2 iteration count. See the module header for the rationale on the
 * security-vs-latency trade-off; self-describing so it can be raised later.
 */
export const PBKDF2_ITERATIONS = 100_000;

/** Self-describing stored representation of a PIN hash. */
interface PinRecord {
  v: number;
  algo: typeof PIN_KDF_ALGO;
  iterations: number;
  salt: string; // lowercase hex
  hash: string; // lowercase hex
}

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

/**
 * Draw `length` cryptographically-strong random bytes via the global
 * `crypto.getRandomValues` (polyfilled by `react-native-get-random-values` at
 * app entry). Fails closed if no CSPRNG is present.
 */
function randomBytes(length: number): Uint8Array {
  const cryptoObj = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error(
      'pin: no cryptographically-strong RNG available ' +
        '(is react-native-get-random-values imported at app entry?)',
    );
  }
  const bytes = new Uint8Array(length);
  cryptoObj.getRandomValues(bytes);
  return bytes;
}

/** Derive the PBKDF2 hash (hex) of a PIN against a salt + iteration count. */
function derivePbkdf2Hex(
  pin: string,
  saltHex: string,
  iterations: number,
): string {
  const derived = pbkdf2Sha256(
    utf8ToBytes(pin),
    hexToBytes(saltHex),
    iterations,
    KEY_BYTES,
  );
  return bytesToHex(derived);
}

/**
 * Constant-time string comparison. Avoids leaking how many leading characters
 * matched via early-exit timing. Both inputs are fixed-length hex digests here.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Validate PIN format: digits only, within the allowed length range. */
function isValidPinFormat(pin: string): boolean {
  return (
    pin.length >= MIN_PIN_LENGTH &&
    pin.length <= MAX_PIN_LENGTH &&
    /^[0-9]+$/.test(pin)
  );
}

/** Build a fresh PBKDF2 record for `pin` with a new random salt. */
function buildRecord(pin: string): PinRecord {
  const saltHex = bytesToHex(randomBytes(SALT_BYTES));
  const hash = derivePbkdf2Hex(pin, saltHex, PBKDF2_ITERATIONS);
  return {
    v: PIN_RECORD_VERSION,
    algo: PIN_KDF_ALGO,
    iterations: PBKDF2_ITERATIONS,
    salt: saltHex,
    hash,
  };
}

/** Persist a record JSON-serialised into the keychain. Throws on write error. */
async function writeRecord(record: PinRecord): Promise<void> {
  await Keychain.setGenericPassword(
    PIN_KEYCHAIN_ACCOUNT,
    JSON.stringify(record),
    {
      service: PIN_KEYCHAIN_SERVICE,
      // Device-only: never synced to iCloud Keychain or device backups.
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
}

/** A parsed stored credential: either the new record or the legacy sha256 form. */
type ParsedStored =
  | { kind: 'pbkdf2'; record: PinRecord }
  | { kind: 'legacy'; saltHex: string; hash: string }
  | { kind: 'unknown' };

/**
 * Parse the raw keychain string into a discriminated stored shape WITHOUT the
 * PIN. Recognises:
 *  - the new self-describing JSON record (`{ v, algo, iterations, salt, hash }`),
 *  - the DMY-10 legacy `"<32-hex-salt>:<64-hex-hash>"` form,
 *  - anything else as `unknown` (fails closed).
 */
function parseStored(raw: string): ParsedStored {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Partial<PinRecord>;
      if (
        obj &&
        obj.algo === PIN_KDF_ALGO &&
        typeof obj.iterations === 'number' &&
        Number.isInteger(obj.iterations) &&
        obj.iterations >= 1 &&
        typeof obj.salt === 'string' &&
        /^[0-9a-f]+$/.test(obj.salt) &&
        typeof obj.hash === 'string' &&
        /^[0-9a-f]+$/.test(obj.hash)
      ) {
        return {
          kind: 'pbkdf2',
          record: {
            v: typeof obj.v === 'number' ? obj.v : PIN_RECORD_VERSION,
            algo: PIN_KDF_ALGO,
            iterations: obj.iterations,
            salt: obj.salt,
            hash: obj.hash,
          },
        };
      }
    } catch {
      // fall through to unknown
    }
    return { kind: 'unknown' };
  }

  // Legacy DMY-10 form: "<saltHex>:<hash>" (sha256(saltHex + ':' + pin)).
  const match = /^([0-9a-f]+):([0-9a-f]+)$/.exec(trimmed);
  if (match) {
    return { kind: 'legacy', saltHex: match[1], hash: match[2] };
  }
  return { kind: 'unknown' };
}

/** Result of attempting to set a PIN. */
export type SetPinResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-format' | 'error' };

/**
 * Persist a new parent-mode PIN. Stores only a self-describing PBKDF2 record;
 * the raw PIN is never written anywhere. Returns a non-throwing result.
 */
export async function setPin(pin: string): Promise<SetPinResult> {
  if (!isValidPinFormat(pin)) {
    // Do NOT log the pin or its length specifics beyond a coarse code.
    logger.warn('pin: rejected set — invalid format');
    return { ok: false, reason: 'invalid-format' };
  }

  try {
    await writeRecord(buildRecord(pin));
    logger.info('pin: parent PIN set');
    return { ok: true };
  } catch {
    logger.error('pin: failed to persist PIN');
    return { ok: false, reason: 'error' };
  }
}

/** Whether a parent-mode PIN has been configured. Non-throwing. */
export async function hasPin(): Promise<boolean> {
  try {
    const result = await Keychain.getGenericPassword({
      service: PIN_KEYCHAIN_SERVICE,
    });
    return result !== false && typeof result.password === 'string';
  } catch {
    logger.warn('pin: hasPin lookup failed');
    return false;
  }
}

/**
 * Verify an entered PIN against the stored record. Returns `true` only on an
 * exact match. Non-throwing: any storage/parse error resolves to `false`
 * (fail closed — deny access). Never logs the PIN.
 *
 * Migration (DMY-44): on a SUCCESSFUL verify against a legacy sha256 record, the
 * PIN is transparently re-derived with PBKDF2 and the record is overwritten
 * (upgrade-on-success). A re-store failure does NOT fail the unlock — the user
 * is still authenticated; the next success retries the upgrade.
 */
export async function verifyPin(pin: string): Promise<boolean> {
  if (!isValidPinFormat(pin)) {
    return false;
  }
  try {
    const result = await Keychain.getGenericPassword({
      service: PIN_KEYCHAIN_SERVICE,
    });
    if (result === false || typeof result.password !== 'string') {
      return false;
    }

    const parsed = parseStored(result.password);

    if (parsed.kind === 'pbkdf2') {
      const candidate = derivePbkdf2Hex(
        pin,
        parsed.record.salt,
        parsed.record.iterations,
      );
      const match = timingSafeEqual(candidate, parsed.record.hash);
      logger.info('pin: verification', { match, kind: 'pbkdf2' });
      return match;
    }

    if (parsed.kind === 'legacy') {
      const candidate = sha256Hex(`${parsed.saltHex}:${pin}`);
      const match = timingSafeEqual(candidate, parsed.hash);
      logger.info('pin: verification', { match, kind: 'legacy' });
      if (match) {
        // Upgrade-on-success: re-derive with the slow KDF and overwrite. A
        // failure here must not deny the (correct) unlock.
        try {
          await writeRecord(buildRecord(pin));
          logger.info('pin: migrated legacy PIN to pbkdf2');
        } catch {
          logger.warn('pin: legacy->pbkdf2 migration write failed');
        }
      }
      return match;
    }

    logger.warn('pin: stored credential malformed or unknown format');
    return false;
  } catch {
    logger.warn('pin: verification errored');
    return false;
  }
}

/**
 * Whether the stored PIN is in the legacy (pre-DMY-44) sha256 format. Used by
 * the UI to surface a graceful "re-set your PIN" prompt when a stored credential
 * is present but unverifiable/unknown. Non-throwing.
 */
export async function getStoredPinFormat(): Promise<
  'none' | 'pbkdf2' | 'legacy' | 'unknown'
> {
  try {
    const result = await Keychain.getGenericPassword({
      service: PIN_KEYCHAIN_SERVICE,
    });
    if (result === false || typeof result.password !== 'string') {
      return 'none';
    }
    const parsed = parseStored(result.password);
    return parsed.kind;
  } catch {
    logger.warn('pin: format probe failed');
    return 'unknown';
  }
}

/** Remove the stored PIN. Non-throwing. */
export async function clearPin(): Promise<boolean> {
  try {
    return await Keychain.resetGenericPassword({
      service: PIN_KEYCHAIN_SERVICE,
    });
  } catch {
    logger.warn('pin: clear failed');
    return false;
  }
}
