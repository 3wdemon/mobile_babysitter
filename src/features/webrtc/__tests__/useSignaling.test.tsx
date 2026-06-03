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
  addAudioTrack = jest.fn();
  addVideoTrack = jest.fn(() => null);
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

  describe('ICE connect-timeout guidance (DMY-47)', () => {
    /** Deterministic scheduler injected via the `iceTimer` option. */
    function fakeScheduler(): {
      setTimer: (cb: () => void, ms: number) => unknown;
      clearTimer: (h: unknown) => void;
      fire: () => void;
      armed: () => boolean;
    } {
      const pending = new Map<number, () => void>();
      let next = 1;
      return {
        setTimer: cb => {
          const h = next++;
          pending.set(h, cb);
          return h;
        },
        clearTimer: h => {
          pending.delete(h as number);
        },
        fire: () => {
          const snap = [...pending.values()];
          pending.clear();
          for (const cb of snap) cb();
        },
        armed: () => pending.size > 0,
      };
    }

    it('sets iceTimedOut + guidance when connecting never reaches connected', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-ice-1');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const sched = fakeScheduler();
      const { result } = renderHook(() =>
        useSignaling({
          transport: a,
          createPeerConnection: () => pc,
          iceTimer: { setTimer: sched.setTimer, clearTimer: sched.clearTimer },
        }),
      );
      await flush();
      // Status is connecting → timer armed, no guidance yet.
      expect(result.current.status).toBe('connecting');
      expect(result.current.iceTimedOut).toBe(false);
      expect(result.current.guidanceMessage).toBeNull();
      expect(sched.armed()).toBe(true);

      act(() => sched.fire());
      expect(result.current.iceTimedOut).toBe(true);
      expect(result.current.guidanceMessage).toBe(
        'Still trying to connect. Check that both phones are on the same Wi-Fi, then restart the connection.',
      );
    });

    it('no guidance and timer cleared when connected arrives before timeout', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-ice-2');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const sched = fakeScheduler();
      const { result } = renderHook(() =>
        useSignaling({
          transport: a,
          createPeerConnection: () => pc,
          iceTimer: { setTimer: sched.setTimer, clearTimer: sched.clearTimer },
        }),
      );
      await flush();
      expect(sched.armed()).toBe(true);

      act(() => pc.emitState('connected'));
      expect(result.current.status).toBe('connected');
      // Timer cancelled — firing it now is a no-op (no false guidance).
      expect(sched.armed()).toBe(false);
      act(() => sched.fire());
      expect(result.current.iceTimedOut).toBe(false);
      expect(result.current.guidanceMessage).toBeNull();
    });

    it('clears the timer (no leak / no fire) on unmount', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-ice-3');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const sched = fakeScheduler();
      const { unmount } = renderHook(() =>
        useSignaling({
          transport: a,
          createPeerConnection: () => pc,
          iceTimer: { setTimer: sched.setTimer, clearTimer: sched.clearTimer },
        }),
      );
      await flush();
      expect(sched.armed()).toBe(true);
      unmount();
      // Timer cancelled on unmount; firing it does not throw / setState.
      expect(sched.armed()).toBe(false);
      expect(() => act(() => sched.fire())).not.toThrow();
    });

    it('clears guidance and timer when stopped', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-ice-4');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const sched = fakeScheduler();
      const { result } = renderHook(() =>
        useSignaling({
          transport: a,
          createPeerConnection: () => pc,
          autoStart: false,
          iceTimer: { setTimer: sched.setTimer, clearTimer: sched.clearTimer },
        }),
      );
      act(() => result.current.start());
      await flush();
      act(() => sched.fire());
      expect(result.current.iceTimedOut).toBe(true);

      act(() => result.current.stop());
      expect(result.current.iceTimedOut).toBe(false);
      expect(result.current.guidanceMessage).toBeNull();
    });
  });
});
