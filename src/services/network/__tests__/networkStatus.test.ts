/**
 * Unit tests for the networkStatus seam (DMY-60).
 *
 * Drives the service through a FAKE NetInfo-like module so nothing touches the
 * native bridge. Covers: state mapping, subscribe/unsubscribe wiring,
 * online↔offline transitions, the optimistic noop source, and the shared-source
 * memoisation / override seam.
 */
import {
  ONLINE_STATE,
  createSourceFromNetInfo,
  getNetworkSource,
  mapNetInfoState,
  noopNetworkSource,
  __setNetworkSource,
  type NetworkState,
} from '../networkStatus';

interface NetInfoState {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
  type?: string | null;
}

/** A controllable fake of the NetInfo module surface the service consumes. */
function createFakeNetInfo(initial: NetInfoState) {
  let listeners: Array<(s: NetInfoState) => void> = [];
  let fetchState = initial;
  const calls = { addEventListener: 0, fetch: 0, unsubscribe: 0 };

  return {
    module: {
      addEventListener: (l: (s: NetInfoState) => void) => {
        calls.addEventListener += 1;
        listeners.push(l);
        return () => {
          calls.unsubscribe += 1;
          listeners = listeners.filter(x => x !== l);
        };
      },
      fetch: () => {
        calls.fetch += 1;
        return Promise.resolve(fetchState);
      },
    },
    emit(state: NetInfoState) {
      fetchState = state;
      for (const l of listeners) {
        l(state);
      }
    },
    setFetch(state: NetInfoState) {
      fetchState = state;
    },
    calls,
    get listenerCount() {
      return listeners.length;
    },
  };
}

describe('mapNetInfoState', () => {
  it('is online when connected and internet reachable', () => {
    expect(
      mapNetInfoState({ isConnected: true, isInternetReachable: true, type: 'wifi' }),
    ).toEqual<NetworkState>({ isOnline: true, type: 'wifi' });
  });

  it('is offline when not connected', () => {
    expect(
      mapNetInfoState({ isConnected: false, isInternetReachable: false, type: 'none' }),
    ).toEqual<NetworkState>({ isOnline: false, type: 'none' });
  });

  it('is offline when connected but internet explicitly unreachable', () => {
    expect(
      mapNetInfoState({ isConnected: true, isInternetReachable: false, type: 'wifi' }),
    ).toEqual<NetworkState>({ isOnline: false, type: 'wifi' });
  });

  it('stays optimistic (online) on a connected LAN with unknown reachability', () => {
    // Valid P2P setup: WiFi up, no internet -> must NOT flag offline.
    expect(
      mapNetInfoState({ isConnected: true, isInternetReachable: null, type: 'wifi' }),
    ).toEqual<NetworkState>({ isOnline: true, type: 'wifi' });
    expect(
      mapNetInfoState({ isConnected: true, type: 'wifi' }),
    ).toEqual<NetworkState>({ isOnline: true, type: 'wifi' });
  });

  it('normalises a missing type to null', () => {
    expect(mapNetInfoState({ isConnected: true }).type).toBeNull();
  });
});

describe('noopNetworkSource', () => {
  it('assumes online and never throws on getCurrent', () => {
    expect(noopNetworkSource.getCurrent()).toEqual(ONLINE_STATE);
    expect(ONLINE_STATE.isOnline).toBe(true);
  });

  it('emits the online snapshot once on subscribe, then never changes', () => {
    const seen: NetworkState[] = [];
    const unsubscribe = noopNetworkSource.subscribe(s => seen.push(s));
    expect(seen).toEqual([ONLINE_STATE]);
    // Unsubscribe is a safe no-op.
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('createSourceFromNetInfo', () => {
  it('settles a new subscriber on the current snapshot immediately', () => {
    const fake = createFakeNetInfo({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    const source = createSourceFromNetInfo(fake.module);

    const seen: NetworkState[] = [];
    source.subscribe(s => seen.push(s));

    // First emission is the optimistic seed (fetch is async, not yet resolved).
    expect(seen[0]).toEqual(ONLINE_STATE);
    expect(fake.calls.addEventListener).toBe(1);
  });

  it('relays online -> offline -> online transitions to subscribers', () => {
    const fake = createFakeNetInfo({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    const source = createSourceFromNetInfo(fake.module);

    const seen: NetworkState[] = [];
    source.subscribe(s => seen.push(s));
    seen.length = 0; // drop the initial seed

    fake.emit({ isConnected: false, isInternetReachable: false, type: 'none' });
    fake.emit({ isConnected: true, isInternetReachable: true, type: 'cellular' });

    expect(seen).toEqual<NetworkState[]>([
      { isOnline: false, type: 'none' },
      { isOnline: true, type: 'cellular' },
    ]);
    // getCurrent reflects the latest emitted state.
    expect(source.getCurrent()).toEqual<NetworkState>({ isOnline: true, type: 'cellular' });
  });

  it('stops relaying after unsubscribe and tears down the native listener', () => {
    const fake = createFakeNetInfo({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    const source = createSourceFromNetInfo(fake.module);

    const seen: NetworkState[] = [];
    const unsubscribe = source.subscribe(s => seen.push(s));
    seen.length = 0;

    expect(fake.listenerCount).toBe(1);
    unsubscribe();
    expect(fake.calls.unsubscribe).toBe(1);
    expect(fake.listenerCount).toBe(0);

    fake.emit({ isConnected: false, type: 'none' });
    expect(seen).toEqual([]); // no more relays
  });

  it('does not crash when a subscriber throws', () => {
    const fake = createFakeNetInfo({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    const source = createSourceFromNetInfo(fake.module);
    source.subscribe(() => {
      throw new Error('subscriber boom');
    });
    expect(() => fake.emit({ isConnected: false, type: 'none' })).not.toThrow();
  });

  it('updates getCurrent from the initial async fetch', async () => {
    const fake = createFakeNetInfo({ isConnected: false, isInternetReachable: false, type: 'none' });
    const source = createSourceFromNetInfo(fake.module);
    // Let the fire-and-forget fetch().then resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(source.getCurrent()).toEqual<NetworkState>({ isOnline: false, type: 'none' });
  });

  it('degrades to optimistic online if addEventListener throws', () => {
    const source = createSourceFromNetInfo({
      addEventListener: () => {
        throw new Error('native exploded');
      },
      fetch: () => Promise.resolve({ isConnected: true }),
    });
    const seen: NetworkState[] = [];
    expect(() => source.subscribe(s => seen.push(s))).not.toThrow();
    expect(seen[0]).toEqual(ONLINE_STATE);
  });
});

describe('shared source seam', () => {
  afterEach(() => {
    __setNetworkSource(null);
  });

  it('returns a stable shared source across calls', () => {
    const a = getNetworkSource();
    const b = getNetworkSource();
    expect(a).toBe(b);
  });

  it('honours an injected override', () => {
    __setNetworkSource(noopNetworkSource);
    expect(getNetworkSource()).toBe(noopNetworkSource);
    __setNetworkSource(null);
    // After reset a fresh source is built (not the override).
    expect(getNetworkSource()).not.toBe(noopNetworkSource);
  });
});
