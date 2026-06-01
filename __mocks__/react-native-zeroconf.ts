/**
 * Jest mock for `react-native-zeroconf` (DMY-7).
 *
 * The real library bridges to a native NSD/DNSSD module (no JS fallback under
 * Jest). The discovery layer abstracts it behind `ZeroconfBackend`; most unit
 * tests inject a fake backend directly. This mock makes the
 * `createZeroconfBackend()` adapter constructable WITHOUT touching native code
 * (the pairing screens build the real adapter) AND lets a screen test drive a
 * resolved/removed event through the adapter via the shared helpers below.
 *
 * It reproduces the surface the adapter uses: a default-exported `Zeroconf`
 * class with `scan` / `stop` / `publishService` / `unpublishService` / `on` /
 * `removeDeviceListeners`. `on` records handlers in module-level state so
 * `__emitResolved` / `__emitRemoved` can fire them. No real mDNS is simulated.
 */
type Handler = (arg: unknown) => void;

interface MockState {
  handlers: Record<string, Handler>;
}

const globalRef = globalThis as typeof globalThis & {
  __ZEROCONF_MOCK__?: MockState;
};

const state: MockState =
  globalRef.__ZEROCONF_MOCK__ ??
  (globalRef.__ZEROCONF_MOCK__ = { handlers: {} });

export function __resetZeroconfMock(): void {
  state.handlers = {};
}

/** Fire the adapter's `resolved` handler with a service object. */
export function __emitResolved(service: unknown): void {
  state.handlers.resolved?.(service);
}

/** Fire the adapter's `remove` handler with an instance name. */
export function __emitRemoved(name: string): void {
  state.handlers.remove?.(name);
}

export default class Zeroconf {
  scan = jest.fn();
  stop = jest.fn();
  publishService = jest.fn();
  unpublishService = jest.fn();
  removeDeviceListeners = jest.fn(() => {
    state.handlers = {};
  });
  getServices = jest.fn(() => ({}));

  on = jest.fn((event: string, handler: Handler) => {
    state.handlers[event] = handler;
  });
}

export const ImplType = { NSD: 'NSD', DNSSD: 'DNSSD' } as const;
