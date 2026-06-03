/**
 * Unit tests for useSignalingTransport (DMY-45, part 2).
 *
 * Asserts: a parent with a resolved endpoint gets a (dialing) transport; a
 * parent with no endpoint / no paired session gets none; a baby without a native
 * listener degrades to no transport (inert); a baby WITH an injected server
 * factory gets that transport.
 */
import { renderHook, act } from '@testing-library/react-native';

import { useSignalingTransport } from '../useSignalingTransport';
import { useAppStore } from '../../../store/useAppStore';
import { createLoopbackTransportPair } from '../signalingTransport';
import type { WebSocketLike } from '../socketSignalingTransport';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

function fakeSocketFactory(): WebSocketLike {
  return {
    readyState: 0,
    send: () => {},
    close: () => {},
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
}

describe('useSignalingTransport', () => {
  beforeEach(() => {
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
  });

  it('returns undefined when not paired', () => {
    act(() => useAppStore.getState().setRole('parent'));
    const { result } = renderHook(() => useSignalingTransport());
    expect(result.current).toBeUndefined();
  });

  it('parent with a resolved endpoint gets a dialing transport', () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-1');
    });
    const { result } = renderHook(() =>
      useSignalingTransport({
        endpoint: { host: '192.168.1.5', port: 8443 },
        webSocketFactory: fakeSocketFactory,
      }),
    );
    expect(result.current).toBeDefined();
    expect(typeof result.current?.connect).toBe('function');
  });

  it('parent with no endpoint gets no transport (nothing to dial)', () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-2');
    });
    const { result } = renderHook(() => useSignalingTransport());
    expect(result.current).toBeUndefined();
  });

  it('baby without a native listener degrades to no transport (inert)', () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-3');
    });
    const { result } = renderHook(() => useSignalingTransport());
    // The default server factory throws → degraded to undefined, not a crash.
    expect(result.current).toBeUndefined();
  });

  it('baby WITH an injected server factory gets that transport', () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-4');
    });
    const listen = createLoopbackTransportPair().a;
    const serverFactory = jest.fn(() => listen);
    const { result } = renderHook(() =>
      useSignalingTransport({ serverFactory }),
    );
    expect(result.current).toBe(listen);
    expect(serverFactory).toHaveBeenCalledTimes(1);
  });

  it('closes a stale transport when the endpoint changes', () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-5');
    });
    const first = createLoopbackTransportPair().a;
    const second = createLoopbackTransportPair().a;
    const closeFirst = jest.spyOn(first, 'close');
    let n = 0;
    const serverFactory = jest.fn(() => (n++ === 0 ? first : second));
    const { rerender } = renderHook(
      ({ tag }: { tag: number }) =>
        useSignalingTransport({
          serverFactory: () => serverFactory(),
          // Force a new identity so the transport is rebuilt.
          endpoint: { host: 'h', port: tag },
        }),
      { initialProps: { tag: 1 } },
    );
    act(() => rerender({ tag: 2 }));
    expect(closeFirst).toHaveBeenCalled();
  });
});
