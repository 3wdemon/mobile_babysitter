/**
 * Unit tests for useSignaling (DMY-16).
 *
 * Uses the real store (MMKV mocked in-memory), a loopback transport and a mock
 * PeerConnection factory. Asserts: the hook derives the role, auto-starts when
 * paired, maps the session status onto the store `connectionStatus` from REAL
 * peer events, stays inert with no transport, and tears down on unmount.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useSignaling } from '../useSignaling';
import { useAppStore } from '../../../store/useAppStore';
import { createLoopbackTransportPair } from '../signalingTransport';
import type {
  PeerConnection,
  PeerConnectionEvents,
  PeerConnectionState,
  SignalingIceCandidate,
  SignalingSdp,
} from '../signalingTypes';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

class MockPeerConnection implements PeerConnection {
  state: PeerConnectionState = 'new';
  remoteSet = false;
  private readonly handlers: {
    [K in keyof PeerConnectionEvents]: Set<PeerConnectionEvents[K]>;
  } = {
    icecandidate: new Set(),
    connectionstatechange: new Set(),
    track: new Set(),
  };
  createOffer = jest.fn(
    async (): Promise<SignalingSdp> => ({ type: 'offer', sdp: 'o' }),
  );
  createAnswer = jest.fn(
    async (): Promise<SignalingSdp> => ({ type: 'answer', sdp: 'a' }),
  );
  setRemoteDescription = jest.fn(async () => {
    this.remoteSet = true;
  });
  addIceCandidate = jest.fn(async (_c: SignalingIceCandidate) => {});
  on<K extends keyof PeerConnectionEvents>(
    event: K,
    handler: PeerConnectionEvents[K],
  ): () => void {
    this.handlers[event].add(handler);
    return () => this.handlers[event].delete(handler);
  }
  getConnectionState(): PeerConnectionState {
    return this.state;
  }
  hasRemoteDescription(): boolean {
    return this.remoteSet;
  }
  close = jest.fn();
  emitState(state: PeerConnectionState): void {
    this.state = state;
    for (const h of this.handlers.connectionstatechange) {
      h(state);
    }
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
    }
  });
}

describe('useSignaling', () => {
  beforeEach(() => {
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
  });

  it('stays inert (no session) when no transport is provided', () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-1');
    });
    const { result } = renderHook(() => useSignaling());
    expect(result.current.isActive).toBe(false);
    expect(useAppStore.getState().connectionStatus).toBe('paired');
  });

  it('stays inert when paired but role/session present without transport', () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-2');
    });
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useSignaling({ createPeerConnection: () => pc }),
    );
    expect(result.current.isActive).toBe(false);
    expect(pc.createOffer).not.toHaveBeenCalled();
  });

  it('parent auto-starts (initiator) and drives connectionStatus to connected on a real peer event', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-3');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();

    const { result } = renderHook(() =>
      useSignaling({ transport: a, createPeerConnection: () => pc }),
    );

    await flush();
    // Initiator created an offer; status is connecting (not yet connected).
    expect(pc.createOffer).toHaveBeenCalled();
    expect(useAppStore.getState().connectionStatus).toBe('connecting');
    expect(result.current.status).toBe('connecting');

    // Real peer event drives connected — never fabricated.
    act(() => pc.emitState('connected'));
    expect(useAppStore.getState().connectionStatus).toBe('connected');
    expect(result.current.status).toBe('connected');
  });

  it('maps a peer failure to connectionStatus "failed"', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-4');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    renderHook(() =>
      useSignaling({ transport: a, createPeerConnection: () => pc }),
    );
    await flush();
    act(() => pc.emitState('failed'));
    expect(useAppStore.getState().connectionStatus).toBe('failed');
  });

  it('tears the session down on unmount (peer connection closed)', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-5');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { unmount } = renderHook(() =>
      useSignaling({ transport: a, createPeerConnection: () => pc }),
    );
    await flush();
    expect(pc.close).not.toHaveBeenCalled();
    unmount();
    expect(pc.close).toHaveBeenCalled();
  });

  it('manual mode (autoStart=false) does not start until start() is called', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-6');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useSignaling({
        transport: a,
        createPeerConnection: () => pc,
        autoStart: false,
      }),
    );
    await flush();
    expect(pc.createOffer).not.toHaveBeenCalled();

    act(() => result.current.start());
    await flush();
    expect(pc.createOffer).toHaveBeenCalled();

    act(() => result.current.stop());
    expect(pc.close).toHaveBeenCalled();
  });
});
