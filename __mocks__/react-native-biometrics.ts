/**
 * Jest mock for `react-native-biometrics` (DMY-10).
 *
 * The real module is a native module with no JS fallback under Jest. This mock
 * reproduces only the surface {@link biometricService} uses — the default-export
 * class with `isSensorAvailable` and `simplePrompt` — and exposes the underlying
 * `jest.fn()`s plus helpers so tests can configure each scenario:
 *
 *   - `__setSensorAvailable(available, biometryType)` — control the probe.
 *   - `__setNextPromptSuccess(success)` — control the next simplePrompt result.
 *   - the raw `mockSimplePrompt` / `mockIsSensorAvailable` fns for advanced cases
 *     (e.g. `mockRejectedValueOnce` to simulate a native error).
 */

export type BiometryType = 'TouchID' | 'FaceID' | 'Biometrics';

export const TouchID = 'TouchID';
export const FaceID = 'FaceID';
export const Biometrics = 'Biometrics';
export const BiometryTypes = { TouchID, FaceID, Biometrics };

let sensorAvailable = true;
let sensorType: BiometryType | undefined = 'FaceID';

export const mockIsSensorAvailable = jest.fn(async () =>
  sensorAvailable
    ? { available: true, biometryType: sensorType }
    : { available: false },
);

export const mockSimplePrompt = jest.fn(async (_opts: {
  promptMessage: string;
}) => ({ success: true }));

/** Configure the simulated sensor for subsequent probes. */
export function __setSensorAvailable(
  available: boolean,
  biometryType: BiometryType = 'FaceID',
): void {
  sensorAvailable = available;
  sensorType = available ? biometryType : undefined;
}

/** Configure the result of the next (and subsequent) simplePrompt calls. */
export function __setNextPromptSuccess(success: boolean): void {
  mockSimplePrompt.mockResolvedValue({ success });
}

/** Reset all mock state and call history to defaults. */
export function __resetBiometricsMock(): void {
  sensorAvailable = true;
  sensorType = 'FaceID';
  mockIsSensorAvailable.mockClear();
  mockSimplePrompt.mockReset();
  mockSimplePrompt.mockResolvedValue({ success: true });
}

export default class ReactNativeBiometrics {
  allowDeviceCredentials: boolean;

  constructor(opts?: { allowDeviceCredentials?: boolean }) {
    this.allowDeviceCredentials = opts?.allowDeviceCredentials ?? false;
  }

  isSensorAvailable() {
    return mockIsSensorAvailable();
  }

  simplePrompt(opts: { promptMessage: string }) {
    return mockSimplePrompt(opts);
  }
}
