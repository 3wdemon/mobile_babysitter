/**
 * In-memory Jest mock for `react-native-keychain` (DMY-10).
 *
 * The real module bridges to the iOS Keychain / Android Keystore and has no JS
 * fallback under Jest. This mock reproduces only the generic-password surface
 * {@link pinService} uses (`setGenericPassword`, `getGenericPassword`,
 * `resetGenericPassword`) plus the `ACCESSIBLE` enum, backed by a per-`service`
 * in-memory map.
 *
 * Crucially it lets tests assert the *security property* of the feature: the
 * stored value is the `salt:hash` string the service writes — never a raw PIN.
 * Tests can read it back via `__getStored(service)` and confirm no plaintext
 * PIN is present.
 */

export const ACCESSIBLE = Object.freeze({
  WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
  AFTER_FIRST_UNLOCK: 'AccessibleAfterFirstUnlock',
  ALWAYS: 'AccessibleAlways',
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY:
    'AccessibleWhenPasscodeSetThisDeviceOnly',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
    'AccessibleAfterFirstUnlockThisDeviceOnly',
} as const);

interface StoredEntry {
  username: string;
  password: string;
}

const store = new Map<string, StoredEntry>();

const DEFAULT_SERVICE = '__default__';

function serviceKey(options?: { service?: string }): string {
  return options?.service ?? DEFAULT_SERVICE;
}

export const setGenericPassword = jest.fn(
  async (
    username: string,
    password: string,
    options?: { service?: string },
  ) => {
    store.set(serviceKey(options), { username, password });
    return { service: serviceKey(options), storage: 'keychain' };
  },
);

export const getGenericPassword = jest.fn(
  async (options?: { service?: string }) => {
    const entry = store.get(serviceKey(options));
    if (!entry) {
      return false;
    }
    return {
      service: serviceKey(options),
      username: entry.username,
      password: entry.password,
      storage: 'keychain',
    };
  },
);

export const hasGenericPassword = jest.fn(
  async (options?: { service?: string }) => store.has(serviceKey(options)),
);

export const resetGenericPassword = jest.fn(
  async (options?: { service?: string }) => store.delete(serviceKey(options)),
);

/** Test-only: read the raw stored entry for a service (or undefined). */
export function __getStored(service?: string): StoredEntry | undefined {
  return store.get(serviceKey({ service }));
}

/** Test-only: clear all stored entries and mock call history. */
export function __resetKeychainMock(): void {
  store.clear();
  setGenericPassword.mockClear();
  getGenericPassword.mockClear();
  hasGenericPassword.mockClear();
  resetGenericPassword.mockClear();
}

export default {
  ACCESSIBLE,
  setGenericPassword,
  getGenericPassword,
  hasGenericPassword,
  resetGenericPassword,
};
