/**
 * In-memory mock of `react-native-mmkv` (v4) for Jest.
 *
 * Why a custom mock instead of the library's built-in test mock:
 * react-native-mmkv ships an auto-mock (`createMockMMKV`), but it allocates a
 * fresh `Map` per `createMMKV()` call, so two instances created with the same
 * `id` do NOT share data. Our persistence tests need to simulate an app
 * restart — re-evaluate the store module and rehydrate from the *same* backing
 * store — which requires id-scoped storage that survives `jest.resetModules()`.
 *
 * This mock reproduces only the surface the app uses (`getString`, `set`,
 * `remove`) plus a `__resetAllMmkv` test helper. Backing stores live on
 * `globalThis` so they persist across module re-evaluation, mirroring real
 * MMKV's on-disk persistence across restarts. `createMMKV({ id })` returns an
 * instance bound to that id's shared backing map.
 */
import type { Configuration } from 'react-native-mmkv';

const GLOBAL_KEY = '__MMKV_MOCK_BACKING_STORES__';

type BackingStores = Map<string, Map<string, string>>;

const globalRef = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: BackingStores;
};

const backingStores: BackingStores =
  globalRef[GLOBAL_KEY] ?? (globalRef[GLOBAL_KEY] = new Map());

function storeFor(id: string): Map<string, string> {
  let store = backingStores.get(id);
  if (!store) {
    store = new Map<string, string>();
    backingStores.set(id, store);
  }
  return store;
}

interface MockMMKV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
  clearAll(): void;
}

/**
 * Mirrors v4's `createMMKV(config)` factory; the real export is a type, not a
 * constructor, so consumers must use this factory.
 */
export function createMMKV(config?: Configuration): MockMMKV {
  const store = storeFor(config?.id ?? 'mmkv.default');
  return {
    getString: key => store.get(key),
    set: (key, value) => {
      store.set(key, value);
    },
    remove: key => store.delete(key),
    clearAll: () => store.clear(),
  };
}

/**
 * Test-only helper: clear every backing store in place so tests start clean.
 * Clearing in place (rather than dropping the registry) keeps already-created
 * instances pointed at the same — now empty — map.
 */
export function __resetAllMmkv(): void {
  for (const store of backingStores.values()) {
    store.clear();
  }
}
