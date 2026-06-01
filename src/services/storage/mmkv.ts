/**
 * MMKV-backed storage for the Mobile Babysitter app.
 *
 * Privacy-first: MMKV is an on-device, synchronous key-value store. No data
 * persisted here leaves the device. This module exposes:
 *  - a shared MMKV instance for app-wide persistence, and
 *  - {@link mmkvStateStorage}, a zustand-compatible {@link StateStorage}
 *    adapter used by the `persist` middleware.
 *
 * react-native-mmkv v4 is Nitro-based: instances are created via `createMMKV`
 * (the `MMKV` export is a type, not a constructor) and the library transparently
 * substitutes an in-memory mock under Jest/Vitest, so no extra native shim is
 * needed in tests.
 *
 * MMKV is synchronous; the adapter wraps each call to satisfy zustand's
 * possibly-async `StateStorage` contract while remaining effectively sync.
 */
import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

/**
 * Shared app-wide MMKV instance.
 *
 * A dedicated `id` keeps app state isolated from any other future MMKV
 * instances (e.g. caches, encrypted stores).
 */
export const storage = createMMKV({ id: 'mobile-babysitter-app' });

/**
 * Zustand `StateStorage` adapter backed by {@link storage}.
 *
 * Returns `null` (not `undefined`) for missing keys, matching the
 * `StateStorage` contract so the `persist` middleware treats absent state as
 * "no persisted value" and falls back to the store's initial state.
 */
export const mmkvStateStorage: StateStorage = {
  getItem: name => {
    const value = storage.getString(name);
    return value ?? null;
  },
  setItem: (name, value) => {
    storage.set(name, value);
  },
  removeItem: name => {
    storage.remove(name);
  },
};
