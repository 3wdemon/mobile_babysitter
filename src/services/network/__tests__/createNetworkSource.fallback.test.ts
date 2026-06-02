/**
 * Module-resolution fallback tests for createNetworkSource (DMY-60).
 *
 * This is AC #3: "NetInfo unavailable (Jest) -> noop assumes online, no crash."
 * The default factory `createNetworkSource()` lazily `require()`s the native
 * `@react-native-community/netinfo` package; when that require throws (native
 * bridge unlinked / bare JS) or returns a malformed module, it must degrade to
 * the optimistic noop source rather than crash.
 *
 * These cases are kept in their OWN file (not the main networkStatus suite)
 * because they mutate the module registry per-test via `jest.doMock` +
 * `jest.isolateModules`; isolating them in a separate file guarantees that
 * mutation cannot leak into the shared-source / memoisation assertions that the
 * main suite makes against the (manual-mock-backed) real source.
 *
 * We intentionally do NOT rely on the global manual mock here, so this file
 * unmocks the package and drives the require() branches explicitly.
 */

interface NetworkStateLike {
  readonly isOnline: boolean;
  readonly type: string | null;
}

describe('createNetworkSource — NetInfo unavailable / malformed (AC #3)', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('falls back to the noop (optimistic online) source when require() throws', () => {
    jest.isolateModules(() => {
      // Native module not linked: requiring it throws, like a missing bridge.
      jest.doMock('@react-native-community/netinfo', () => {
        throw new Error('native module not linked');
      });
      const mod = require('../networkStatus');
      const source = mod.createNetworkSource();

      // Noop behaviour: assumes online, emits the online snapshot once, never
      // throws on subscribe/getCurrent.
      expect(source.getCurrent()).toEqual(mod.ONLINE_STATE);
      expect(source.getCurrent().isOnline).toBe(true);
      const seen: NetworkStateLike[] = [];
      const unsubscribe = source.subscribe((s: NetworkStateLike) => seen.push(s));
      expect(seen).toEqual([mod.ONLINE_STATE]);
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  it('falls back to the noop source when the module resolves but is malformed', () => {
    jest.isolateModules(() => {
      // Resolves, but missing the addEventListener/fetch API we depend on.
      jest.doMock('@react-native-community/netinfo', () => ({ default: {} }));
      const mod = require('../networkStatus');
      const source = mod.createNetworkSource();

      expect(source.getCurrent()).toEqual(mod.ONLINE_STATE);
      const seen: NetworkStateLike[] = [];
      expect(() => source.subscribe((s: NetworkStateLike) => seen.push(s))).not.toThrow();
      expect(seen).toEqual([mod.ONLINE_STATE]);
    });
  });

  it('falls back to the noop source when the module default is null', () => {
    jest.isolateModules(() => {
      jest.doMock('@react-native-community/netinfo', () => ({ default: null }));
      const mod = require('../networkStatus');
      const source = mod.createNetworkSource();
      expect(source.getCurrent()).toEqual(mod.ONLINE_STATE);
    });
  });
});
