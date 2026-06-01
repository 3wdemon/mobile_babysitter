/**
 * biometricService — thin, non-throwing wrapper around `react-native-biometrics`
 * (DMY-10).
 *
 * The parent monitoring mode can be locked behind device biometrics (Face ID /
 * Touch ID / Android biometric prompt). This module is the single integration
 * point with the native library so the rest of the app never imports it
 * directly, and so the surface can be mocked wholesale in tests.
 *
 * Design rules:
 *  - **Total / non-throwing.** Every function resolves to a result object and
 *    never rejects. The native library rejects its promise on user cancel and
 *    on hardware errors; callers must not have to distinguish a thrown error
 *    from a "denied" result, so we normalise everything into a discriminated
 *    union. A failed/declined biometric is a normal control-flow path that
 *    falls back to the PIN — not an exception.
 *  - **Privacy.** We log only coarse, non-sensitive facts (sensor availability,
 *    success/failure) through the redacting {@link logger}. No prompt payloads,
 *    no error strings that could carry user data.
 */
import ReactNativeBiometrics, {
  type BiometryType,
} from 'react-native-biometrics';

import { logger } from '../../services/logger';

/**
 * Re-export of the library's biometry type so consumers (UI copy, tests) do not
 * need to import the native package directly.
 */
export type { BiometryType };

/**
 * Result of probing the device's biometric sensor.
 */
export interface SensorAvailability {
  /** Whether a usable biometric sensor is enrolled and available. */
  available: boolean;
  /** Concrete sensor type when available (`FaceID` / `TouchID` / `Biometrics`). */
  biometryType?: BiometryType;
}

/**
 * Outcome of a biometric prompt. A discriminated union on `success`:
 *  - `{ success: true }` — the user authenticated.
 *  - `{ success: false, reason }` — declined/cancelled (`'declined'`),
 *    the sensor was unavailable (`'unavailable'`), or the native call errored
 *    (`'error'`). All three route the caller to the PIN fallback.
 */
export type BiometricAuthResult =
  | { success: true }
  | { success: false; reason: 'declined' | 'unavailable' | 'error' };

/**
 * Lazily-created singleton. `allowDeviceCredentials` is left false: the device
 * passcode fallback is handled by our own PIN flow, not the OS sheet, so the
 * behaviour is consistent across iOS/Android and testable.
 */
let rnBiometrics: ReactNativeBiometrics | null = null;

function getInstance(): ReactNativeBiometrics {
  if (!rnBiometrics) {
    rnBiometrics = new ReactNativeBiometrics({ allowDeviceCredentials: false });
  }
  return rnBiometrics;
}

/**
 * Probe whether the device has an available, enrolled biometric sensor.
 *
 * Never throws: on any native error this resolves to `{ available: false }`,
 * so the caller treats an erroring sensor exactly like an absent one and falls
 * back to the PIN.
 */
export async function isSensorAvailable(): Promise<SensorAvailability> {
  try {
    const { available, biometryType } =
      await getInstance().isSensorAvailable();
    logger.debug('biometric: sensor probe', { available, biometryType });
    return available ? { available: true, biometryType } : { available: false };
  } catch {
    // Treat a probe failure as "no sensor" — the safe, fall-back-to-PIN path.
    logger.warn('biometric: sensor probe failed');
    return { available: false };
  }
}

/**
 * Prompt the user for biometric authentication.
 *
 * @param promptMessage Localised, NON-sensitive message shown in the native
 *   sheet (e.g. "Unlock parent mode"). Must not contain user data.
 *
 * Behaviour:
 *  - sensor unavailable -> `{ success: false, reason: 'unavailable' }`
 *    (no prompt is shown).
 *  - user authenticates -> `{ success: true }`.
 *  - user cancels/declines -> `{ success: false, reason: 'declined' }`.
 *  - native error / rejection -> `{ success: false, reason: 'error' }`.
 */
export async function authenticate(
  promptMessage: string,
): Promise<BiometricAuthResult> {
  const sensor = await isSensorAvailable();
  if (!sensor.available) {
    return { success: false, reason: 'unavailable' };
  }

  try {
    const { success } = await getInstance().simplePrompt({ promptMessage });
    if (success) {
      logger.info('biometric: authentication succeeded');
      return { success: true };
    }
    // Library reports success=false on user cancel.
    logger.info('biometric: authentication declined');
    return { success: false, reason: 'declined' };
  } catch {
    // simplePrompt rejects on hardware/lockout errors. Do not log the error
    // object (may carry platform detail); coarse fact only.
    logger.warn('biometric: authentication errored');
    return { success: false, reason: 'error' };
  }
}

/**
 * Test-only: reset the cached native instance so a fresh mock is picked up.
 * No-op in production usage.
 */
export function __resetBiometricInstance(): void {
  rnBiometrics = null;
}
