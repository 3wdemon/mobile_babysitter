/**
 * Unit tests for useBabyBroadcast (DMY-66) — the screen-facing fan-out hook.
 *
 * Uses the real store (MMKV mocked), a fake multi-client accept-loop transport
 * and mock peer connections. Asserts the hook:
 *   - stays inert with no transport (never fabricates a parent);
 *   - mirrors the connected-parents list into state as parents connect / leave;
 *   - reports `capReached` once the cap is hit and clears it when one leaves;
 *   - tears the manager down on unmount (no capture leak).
 */
import { act, renderHook } from '@testing-library/react-native';

import { useBabyBroadcast } from '../useBabyBroadcast';
import { useAppStore } from '../../../store/useAppStore';
import type { MultiClientSignalingTransport } from '../babyBroadcast';
import type {
  MediaDevicesLike,
  MediaStreamLike,
  MediaStreamTrackLike,
  RtpSenderLike,
} from '../mediaTypes';
import type {
  PeerConnection,
  PeerConnectionEvents,
  PeerConnectionState,
  SignalingIceCandidate,
  SignalingSdp,
  SignalingTransport,
} from '../signalingTypes';
import { createLoopbackTransportPair } from '../signalingTransport';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

class MockPc implements PeerConnection {
  state: PeerConnectionState = 'new';
  remoteSet = false;
  private readonly handlers: {
    [K in keyof PeerConnectionEvents]: Set<PeerConnectionEvents[K]>;
  } = {
    icecandidate: new Set(),
    connectionstatechange: new Set(),
    track: new Set(),
    datachannel: new Set(),
  };
  createOffer = jest.fn(
    async (): Promise<SignalingSdp> => ({ type: 'offer', sdp: 's' }),
  );
  createAnswer = jest.fn(
    async (): Promise<SignalingSdp> => ({ type: 'answer', sdp: 's' }),
  );
  setRemoteDescription = jest.fn(async () => {
    this.remoteSet = true;
  });
  addIceCandidate = jest.fn(async (_c: SignalingIceCandidate) => {});
  addAudioTrack = jest.fn();
  addVideoTrack = jest.fn((): RtpSenderLike | null => null);
  createDataChannel = jest.fn(() => null);
  on<K extends keyof PeerConnectionEvents>(e: K, h: PeerConnectionEvents[K]) {
    this.handlers[e].add(h);
    return () => this.handlers[e].delete(h);
  }
  getConnectionState() {
    return this.state;
  }
  async getStats() {
    return new Map();
  }
  hasRemoteDescription() {
    return this.remoteSet;
  }
  close = jest.fn();
  emitState(s: PeerConnectionState) {
    this.state = s;
    for (const h of this.handlers.connectionstatechange) h(s);
  }
}

function makeCapture(): {
  stream: MediaStreamLike;
  audio: MediaStreamTrackLike;
} {
  const audio: MediaStreamTrackLike = {
    kind: 'audio',
    enabled: true,
    stop: jest.fn(),
  };
  const video: MediaStreamTrackLike = {
    kind: 'video',
    enabled: true,
    stop: jest.fn(),
  };
  return {
    audio,
    stream: {
      getTracks: () => [audio, video],
      getAudioTracks: () => [audio],
      getVideoTracks: () => [video],
    },
  };
}

function makeTransport() {
  let connect: ((id: string, tx: SignalingTransport) => void) | null = null;
  const transport: MultiClientSignalingTransport = {
    onClientConnect(h) {
      connect = h;
      return () => {
        connect = null;
      };
    },
    async start() {},
    close() {},
  };
  return {
    transport,
    connect: (id: string, tx: SignalingTransport) => connect?.(id, tx),
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

describe('useBabyBroadcast', () => {
  beforeEach(() => {
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-fanout');
    });
  });

  it('stays inert with no transport (no fabricated parents)', async () => {
    const { result } = renderHook(() => useBabyBroadcast());
    await flush();
    expect(result.current.parents).toEqual([]);
    expect(result.current.connectedCount).toBe(0);
    expect(result.current.capturing).toBe(false);
    expect(result.current.capReached).toBe(false);
  });

  it('mirrors parents into state as they connect via the accept loop', async () => {
    const t = makeTransport();
    const cap = makeCapture();
    const md: MediaDevicesLike = {
      getUserMedia: jest.fn(async () => cap.stream),
    };
    const { result } = renderHook(() =>
      useBabyBroadcast({
        transport: t.transport,
        mediaDevices: md,
        createPeerConnection: () => new MockPc(),
      }),
    );
    await flush();

    await act(async () => {
      const { a } = createLoopbackTransportPair();
      t.connect('p1', a);
      const { a: a2 } = createLoopbackTransportPair();
      t.connect('p2', a2);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    expect(result.current.parents.map(p => p.clientId)).toEqual(['p1', 'p2']);
    expect(result.current.maxParents).toBe(3);
  });

  it('reports capReached at the cap and clears it when a parent leaves', async () => {
    const t = makeTransport();
    const cap = makeCapture();
    const md: MediaDevicesLike = {
      getUserMedia: jest.fn(async () => cap.stream),
    };
    const pcs: MockPc[] = [];
    const { result } = renderHook(() =>
      useBabyBroadcast({
        transport: t.transport,
        mediaDevices: md,
        maxParents: 2,
        createPeerConnection: () => {
          const pc = new MockPc();
          pcs.push(pc);
          return pc;
        },
      }),
    );
    await flush();

    await act(async () => {
      const { a } = createLoopbackTransportPair();
      t.connect('p1', a);
      const { a: a2 } = createLoopbackTransportPair();
      t.connect('p2', a2);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(result.current.parents).toHaveLength(2);
    expect(result.current.capReached).toBe(true);

    // p1's peer fails → it drops; cap notice clears.
    await act(async () => {
      pcs[0].emitState('failed');
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(result.current.parents.map(p => p.clientId)).toEqual(['p2']);
    expect(result.current.capReached).toBe(false);
  });

  it('tears the manager down on unmount (no capture leak)', async () => {
    const t = makeTransport();
    const cap = makeCapture();
    const md: MediaDevicesLike = {
      getUserMedia: jest.fn(async () => cap.stream),
    };
    const { result, unmount } = renderHook(() =>
      useBabyBroadcast({
        transport: t.transport,
        mediaDevices: md,
        createPeerConnection: () => new MockPc(),
      }),
    );
    await flush();
    await act(async () => {
      const { a } = createLoopbackTransportPair();
      t.connect('p1', a);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(result.current.capturing).toBe(true);

    unmount();
    // The shared capture's mic track was stopped on teardown (no leak).
    expect(cap.audio.stop).toHaveBeenCalled();
  });
});
