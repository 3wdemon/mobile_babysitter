/**
 * pinService — PIN fallback for the parent-mode lock (DMY-10).
 *
 * When biometrics are unavailable or declined, the parent unlocks with a PIN.
 * The PIN is the user's secret and MUST NOT be stored in plaintext anywhere
 * (no MMKV, no logs). This module:
 *
 *  - derives a one-way hash of the PIN (`sha256(salt + pin)`) with a per-install
 *    random salt, and
 *  - persists ONLY `salt:hash` in the OS secure store via
 *    `react-native-keychain` (iOS Keychain / Android Keystore, app-sandboxed,
 *    `*_THIS_DEVICE_ONLY` accessibility so it is never synced to iCloud/backups).
 *
 * Verification re-derives the hash from the entered PIN and the stored salt and
 * compares in constant time. The raw PIN exists only transiently in memory for
 * the duration of a `set`/`verify` call.
 *
 * Threat-model note: a numeric PIN is low-entropy, so a fast hash is not a
 * defence against an attacker who has already extracted the keychain blob — but
 * that requires defeating the Secure Enclave/Keystore + device passcode first.
 * For a *local device-unlock* PIN backing a biometric gate this is the standard,
 * appropriate construction. We are explicitly NOT building an account password
 * store (no server, no cross-device sync). A slow KDF (PBKDF2/scrypt) would be
 * the next hardening step and is noted for a follow-up rather than faked here.
 */
import * as Keychain from 'react-native-keychain';

import { logger } from '../../services/logger';
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

const SALT_BYTES = 16;

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

/**
 * Draw `length` cryptographically-strong random bytes via the global
 * `crypto.getRandomValues` (polyfilled by `react-native-get-random-values` at
 * app entry). Fails closed if no CSPRNG is present.
 */
function randomSaltHex(length: number): string {
  const cryptoObj = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error(
      'pin: no cryptographically-strong RNG available ' +
        '(is react-native-get-random-values imported at app entry?)',
    );
  }
  const bytes = new Uint8Array(length);
  cryptoObj.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Derive the stored representation `salt:hash` from a PIN + salt. */
function deriveHash(pin: string, saltHex: string): string {
  return sha256Hex(`${saltHex}:${pin}`);
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

/** Result of attempting to set a PIN. */
export type SetPinResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-format' | 'error' };

/**
 * Persist a new parent-mode PIN. Stores only `salt:hash` in the keychain; the
 * raw PIN is never written anywhere. Returns a non-throwing result.
 */
export async function setPin(pin: string): Promise<SetPinResult> {
  if (!isValidPinFormat(pin)) {
    // Do NOT log the pin or its length specifics beyond a coarse code.
    logger.warn('pin: rejected set — invalid format');
    return { ok: false, reason: 'invalid-format' };
  }

  try {
    const saltHex = randomSaltHex(SALT_BYTES);
    const stored = `${saltHex}:${deriveHash(pin, saltHex)}`;
    await Keychain.setGenericPassword(PIN_KEYCHAIN_ACCOUNT, stored, {
      service: PIN_KEYCHAIN_SERVICE,
      // Device-only: never synced to iCloud Keychain or device backups.
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
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
 * Verify an entered PIN against the stored `salt:hash`. Returns `true` only on
 * an exact match. Non-throwing: any storage/parse error resolves to `false`
 * (fail closed — deny access). Never logs the PIN.
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
    const sep = result.password.indexOf(':');
    if (sep <= 0) {
      logger.warn('pin: stored credential malformed');
      return false;
    }
    const saltHex = result.password.slice(0, sep);
    const storedHash = result.password.slice(sep + 1);
    const candidate = deriveHash(pin, saltHex);
    const match = timingSafeEqual(candidate, storedHash);
    logger.info('pin: verification', { match });
    return match;
  } catch {
    logger.warn('pin: verification errored');
    return false;
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
