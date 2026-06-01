/**
 * Jest mock for `react-native-permissions` (DMY-42).
 *
 * The real module is a native TurboModule with no JS fallback, so it must be
 * mocked for unit tests. This mock reproduces only the surface
 * {@link usePermissions} uses — `PERMISSIONS`, `RESULTS`, `requestMultiple`,
 * `requestNotifications` — and defaults every request to GRANTED. Individual
 * tests override the `jest.fn()`s (e.g. to simulate a denial or a thrown
 * native error) via `mockResolvedValueOnce` / `mockRejectedValueOnce`.
 */

export const RESULTS = Object.freeze({
  UNAVAILABLE: 'unavailable',
  BLOCKED: 'blocked',
  DENIED: 'denied',
  GRANTED: 'granted',
  LIMITED: 'limited',
} as const);

export const PERMISSIONS = Object.freeze({
  IOS: {
    CAMERA: 'ios.permission.CAMERA',
    MICROPHONE: 'ios.permission.MICROPHONE',
  },
  ANDROID: {
    CAMERA: 'android.permission.CAMERA',
    RECORD_AUDIO: 'android.permission.RECORD_AUDIO',
  },
} as const);

/** Default: grant both camera + microphone. Tests override per-case. */
export const requestMultiple = jest.fn(async (permissions: string[]) => {
  const result: Record<string, string> = {};
  for (const permission of permissions) {
    result[permission] = RESULTS.GRANTED;
  }
  return result;
});

/** Default: grant notifications with all settings on. */
export const requestNotifications = jest.fn(async (_options: string[]) => ({
  status: RESULTS.GRANTED,
  settings: {},
}));

export const check = jest.fn(async () => RESULTS.GRANTED);
export const request = jest.fn(async () => RESULTS.GRANTED);
export const checkNotifications = jest.fn(async () => ({
  status: RESULTS.GRANTED,
  settings: {},
}));
export const openSettings = jest.fn(async () => undefined);

export default {
  PERMISSIONS,
  RESULTS,
  requestMultiple,
  requestNotifications,
  check,
  request,
  checkNotifications,
  openSettings,
};
