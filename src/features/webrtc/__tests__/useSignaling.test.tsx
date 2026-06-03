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

    it('re-arms a fresh window on churn and clears guidance once connected arrives', async () => {
      // A reconnect churn at the hook level: a first hang shows guidance; the
      // session then churns (disconnected → connecting) which must re-arm a fresh
      // window; reaching `connected` clears the earlier guidance. Verifies the
      // hook drives the controller across the full real status sequence.
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-ice-churn');
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

      // First window hangs → guidance shown.
      act(() => sched.fire());
      expect(result.current.iceTimedOut).toBe(true);

      // Churn: disconnected then connecting re-arms a fresh window.
      act(() => pc.emitState('disconnected'));
      act(() => pc.emitState('connecting'));
      expect(sched.armed()).toBe(true);

      // The reconnect succeeds in time → guidance cleared, no re-fire.
      act(() => pc.emitState('connected'));
      expect(result.current.status).toBe('connected');
      expect(result.current.iceTimedOut).toBe(false);
      expect(result.current.guidanceMessage).toBeNull();
      act(() => sched.fire());
      expect(result.current.iceTimedOut).toBe(false);
    });

    it('does not show guidance when the fire races AFTER stop (no setState past teardown)', async () => {
      // stop() cancels the pending timer; even a stray fire afterward must not
      // re-surface guidance on a torn-down session.
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-ice-stopfire');
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
      expect(sched.armed()).toBe(true);

      act(() => result.current.stop());
      expect(sched.armed()).toBe(false);
      // A stray fire after stop must be inert.
      expect(() => act(() => sched.fire())).not.toThrow();
      expect(result.current.iceTimedOut).toBe(false);
      expect(result.current.guidanceMessage).toBeNull();
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

  describe('auto-reconnect with backoff (DMY-61)', () => {
    /** Deterministic scheduler + fixed RNG injected via `reconnectTimer`. */
    function fakeReconnectTimer(): {
      setTimer: (cb: () => void, ms: number) => unknown;
      clearTimer: (h: unknown) => void;
      fire: () => void;
      armed: () => boolean;
      lastDelay: () => number | null;
      rng: () => number;
    } {
      const pending = new Map<number, () => void>();
      let next = 1;
      let lastDelay: number | null = null;
      return {
        setTimer: (cb, ms) => {
          const h = next++;
          lastDelay = ms;
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
        lastDelay: () => lastDelay,
        rng: () => 0,
      };
    }

    it('on an unclean disconnected after connected, retries with exponential backoff then connects (resets + banner hidden)', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-rc-1');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const rc = fakeReconnectTimer();
      const { result } = renderHook(() =>
        useSignaling({
          transport: a,
          createPeerConnection: () => pc,
          reconnectTimer: {
            setTimer: rc.setTimer,
            clearTimer: rc.clearTimer,
            rng: rc.rng,
          },
        }),
      );
      await flush();
      // Reach a live connection first.
      act(() => pc.emitState('connected'));
      expect(result.current.status).toBe('connected');
      expect(result.current.reconnecting).toBe(false);

      // Unclean drop → backoff scheduled at the base 1s, banner shows attempt 1.
      act(() => pc.emitState('disconnected'));
      expect(result.current.reconnecting).toBe(true);
      expect(result.current.reconnectAttempt).toBe(1);
      expect(rc.lastDelay()).toBe(1000);

      // The backoff tick re-runs the connect path on a fresh session.
      await act(async () => {
        rc.fire();
        await Promise.resolve();
      });
      expect(result.current.reconnecting).toBe(true);

      // The reconnect succeeds: backoff resets, banner hidden, status connected.
      act(() => pc.emitState('connected'));
      expect(result.current.status).toBe('connected');
      expect(result.current.reconnecting).toBe(false);
      expect(result.current.reconnectAttempt).toBe(0);
      expect(result.current.reconnectFailed).toBe(false);
    });

    it('exhausts max attempts → stops retrying, marks failed, manual retry() re-attempts', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-rc-2');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const rc = fakeReconnectTimer();
      const { result } = renderHook(() =>
        useSignaling({
          transport: a,
          createPeerConnection: () => pc,
          reconnectPolicy: {
            baseMs: 1000,
            maxDelayMs: 30_000,
            maxAttempts: 2,
            jitterRatio: 0,
          },
          reconnectTimer: {
            setTimer: rc.setTimer,
            clearTimer: rc.clearTimer,
            rng: rc.rng,
          },
        }),
      );
      await flush();
      act(() => pc.emitState('connected'));

      // First unclean drop → schedule attempt 0.
      act(() => pc.emitState('disconnected'));
      expect(result.current.reconnecting).toBe(true);

      // Attempt 1 fires and fails again → schedule attempt 1.
      await act(async () => {
        rc.fire();
        await Promise.resolve();
      });
      act(() => pc.emitState('failed'));
      expect(result.current.reconnecting).toBe(true);

      // Attempt 2 fires and fails → past the cap (2) → STOP, mark failed.
      await act(async () => {
        rc.fire();
        await Promise.resolve();
      });
      act(() => pc.emitState('failed'));
      expect(result.current.reconnectFailed).toBe(true);
      expect(result.current.reconnecting).toBe(false);
      // No more timers scheduled — no infinite loop.
      expect(rc.armed()).toBe(false);

      // Manual retry re-arms the burst from the base delay.
      act(() => result.current.retry());
      expect(result.current.reconnectFailed).toBe(false);
      expect(result.current.reconnecting).toBe(true);
      expect(result.current.reconnectAttempt).toBe(1);
      expect(rc.lastDelay()).toBe(1000);
      await act(async () => {
        rc.fire();
        await Promise.resolve();
      });
      // The retry attempt then connects.
      act(() => pc.emitState('connected'));
      expect(result.current.reconnecting).toBe(false);
    });

    it('disconnect→reconnecting→disconnect again continues the SAME burst (attempt increments, not reset)', async () => {
      // Edge: flapping. After the first backoff tick re-launches the session, a
      // second unclean drop must advance the attempt (2s, attempt 2), not restart
      // the burst at the base delay (1s, attempt 1).
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-rc-flap');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const rc = fakeReconnectTimer();
      const { result } = renderHook(() =>
        useSignaling({
          transport: a,
          createPeerConnection: () => pc,
          reconnectTimer: {
            setTimer: rc.setTimer,
            clearTimer: rc.clearTimer,
            rng: rc.rng,
          },
        }),
      );
      await flush();
      act(() => pc.emitState('connected'));

      // First unclean drop → attempt 1 @ 1s.
      act(() => pc.emitState('disconnected'));
      expect(result.current.reconnectAttempt).toBe(1);
      expect(rc.lastDelay()).toBe(1000);

      // Backoff tick re-launches a fresh session.
      await act(async () => {
        rc.fire();
        await Promise.resolve();
      });
      // The fresh session drops again → SAME burst continues: attempt 2 @ 2s.
      act(() => pc.emitState('disconnected'));
      expect(result.current.reconnecting).toBe(true);
      expect(result.current.reconnectAttempt).toBe(2);
      expect(rc.lastDelay()).toBe(2000);
    });

    it('rapid connect/disconnect flapping: a clean reconnect resets the burst to the base delay', async () => {
      // Edge: after a burst has escalated, a successful reconnect must fully reset
      // so the NEXT unclean drop starts again at attempt 1 / 1s (not escalated).
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-rc-flap2');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const rc = fakeReconnectTimer();
      const { result } = renderHook(() =>
        useSignaling({
          transport: a,
          createPeerConnection: () => pc,
          reconnectTimer: {
            setTimer: rc.setTimer,
            clearTimer: rc.clearTimer,
            rng: rc.rng,
          },
        }),
      );
      await flush();
      act(() => pc.emitState('connected'));

      // Escalate a couple of steps.
      act(() => pc.emitState('disconnected'));
      await act(async () => {
        rc.fire();
        await Promise.resolve();
      });
      act(() => pc.emitState('failed'));
      expect(rc.lastDelay()).toBe(2000);

      // Reconnect succeeds → banner hidden, counters reset.
      await act(async () => {
        rc.fire();
        await Promise.resolve();
      });
      act(() => pc.emitState('connected'));
      expect(result.current.reconnecting).toBe(false);
      expect(result.current.reconnectAttempt).toBe(0);

      // A brand-new drop restarts the burst at the base delay.
      act(() => pc.emitState('disconnected'));
      expect(result.current.reconnectAttempt).toBe(1);
      expect(rc.lastDelay()).toBe(1000);
    });

    it('does NOT reconnect on a clean local stop() (no backoff scheduled)', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-rc-3');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const rc = fakeReconnectTimer();
      const { result } = renderHook(() =>
        useSignaling({
          transport: a,
          createPeerConnection: () => pc,
          autoStart: false,
          reconnectTimer: {
            setTimer: rc.setTimer,
            clearTimer: rc.clearTimer,
            rng: rc.rng,
          },
        }),
      );
      act(() => result.current.start());
      await flush();
      act(() => pc.emitState('connected'));

      // A clean local stop must NOT trigger reconnect even though teardown can
      // surface a disconnected-like state — this is the DMY-45 boundary at this
      // layer (local stop = clean; remote `bye` wiring lands in DMY-45).
      act(() => result.current.stop());
      expect(result.current.reconnecting).toBe(false);
      expect(rc.armed()).toBe(false);
      // A late stray peer event after stop must not resurrect a reconnect.
      act(() => pc.emitState('disconnected'));
      expect(result.current.reconnecting).toBe(false);
      expect(rc.armed()).toBe(false);
    });

    it('cancels any pending reconnect on unmount (no leak / no setState past teardown)', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-rc-4');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const rc = fakeReconnectTimer();
      const { result, unmount } = renderHook(() =>
        useSignaling({
          transport: a,
          createPeerConnection: () => pc,
          reconnectTimer: {
            setTimer: rc.setTimer,
            clearTimer: rc.clearTimer,
            rng: rc.rng,
          },
        }),
      );
      await flush();
      act(() => pc.emitState('connected'));
      act(() => pc.emitState('disconnected'));
      expect(result.current.reconnecting).toBe(true);
      expect(rc.armed()).toBe(true);

      unmount();
      // Timer cancelled on unmount; firing it does not throw / setState.
      expect(rc.armed()).toBe(false);
      expect(() => act(() => rc.fire())).not.toThrow();
    });

    it('a never-connected initial failure does NOT trigger reconnect', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-rc-5');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const rc = fakeReconnectTimer();
      const { result } = renderHook(() =>
        useSignaling({
          transport: a,
          createPeerConnection: () => pc,
          reconnectTimer: {
            setTimer: rc.setTimer,
            clearTimer: rc.clearTimer,
            rng: rc.rng,
          },
        }),
      );
      await flush();
      // Never reached connected → a handshake failure is not a reconnect.
      act(() => pc.emitState('failed'));
      expect(result.current.reconnecting).toBe(false);
      expect(rc.armed()).toBe(false);
    });

    it('respects autoReconnect=false (no backoff on an unclean drop)', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-rc-6');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const rc = fakeReconnectTimer();
      const { result } = renderHook(() =>
        useSignaling({
          transport: a,
          createPeerConnection: () => pc,
          autoReconnect: false,
          reconnectTimer: {
            setTimer: rc.setTimer,
            clearTimer: rc.clearTimer,
            rng: rc.rng,
          },
        }),
      );
      await flush();
      act(() => pc.emitState('connected'));
      act(() => pc.emitState('disconnected'));
      expect(result.current.reconnecting).toBe(false);
      expect(rc.armed()).toBe(false);
    });
  });
});
