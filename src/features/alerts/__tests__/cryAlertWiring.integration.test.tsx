/**
 * End-to-end integration test for DMY-77: the FULL live alert wire from a cry on
 * the baby to a notification + haptic on the parent, exercised through the SAME
 * production seams the screens use.
 *
 *   baby cry sample → useCryAlertSource (AlertChannelSource)
 *     → createBabyBroadcast fan-out (the SOLE baby publish path, DMY-75)
 *       → responder session opens the alert data channel (DMY-71)
 *         → pushAlertsToChannel serializes {type,timestamp} onto the wire
 *           ── loopback data-channel bridge ──
 *         → receiveAlertsFromChannel (the EXACT adapter useMediaSession runs on
 *            the parent) parses + drives BOTH sinks: presenter (DMY-46) + haptic
 *            (DMY-28).
 *
 * The parent end uses `receiveAlertsFromChannel` directly with the SAME options
 * shape (`{ presenter, haptic }`) that the parent screen now feeds into
 * `useMediaSession({ alertReceiver })` — so this covers the full source→channel→
 * sink path that part (а)/(б)/(в) wire, without two store-role hooks contending
 * over the single global `role`. The session-side channel lifecycle (open by
 * role, adopt via `datachannel`, cleanup on teardown) is covered by
 * signalingSession.alertChannel.test.ts.
 *
 * Asserts the POSITIVE wire (a sustained cry fires presenter.present + haptic
 * with the privacy-safe `{type:'cry', soundId:''}` payload) and the NEGATIVE
 * case (a sub-5s burst raises no cry → no datachannel send → no parent alert).
 *
 * No real audio / WebRTC: a mock peer connection carries a loopback data-channel
 * bridge; mediaDevices, the cry-feature source, the presenter and the haptic are
 * all fakes plugging into the contracts production uses. Every wiring seam under
 * test is real.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useCryAlertSource } from '../../detection/useCryAlertSource';
import type { CrySample, CrySampleSource } from '../../detection/cryTypes';
import { createBabyBroadcast } from '../../webrtc/babyBroadcast';
import type { MultiClientSignalingTransport } from '../../webrtc/babyBroadcast';
import { createLoopbackTransportPair } from '../../webrtc/signalingTransport';
import { useAppStore } from '../../../store/useAppStore';
import { receiveAlertsFromChannel } from '../alertChannel';
import type { AlertNotificationPresenter } from '../notificationPresenter';
import type { HapticFeedback } from '../hapticFeedback';
import type {
  MediaDevicesLike,
  MediaStreamLike,
  MediaStreamTrackLike,
} from '../../webrtc/mediaTypes';
import type {
  DataChannel,
  PeerConnection,
  PeerConnectionEvents,
  PeerConnectionState,
  SignalingIceCandidate,
  SignalingSdp,
} from '../../webrtc/signalingTypes';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

const SID = 'pair-dmy77';
const SRTP_SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
].join('\r\n');

/**
 * A loopback alert data channel: a send on one end surfaces as a message on the
 * peer end. Models the wire so the parent's receiveAlertsFromChannel sees exactly
 * what the baby's pushAlertsToChannel sent.
 */
class LoopbackDataChannel implements DataChannel {
  closed = false;
  peer: LoopbackDataChannel | null = null;
  private readonly messageHandlers = new Set<(p: string) => void>();
  private readonly closeHandlers = new Set<() => void>();
  constructor(public readonly label: string) {}
  send(payload: string): boolean {
    if (this.closed || !this.peer || this.peer.closed) {
      return false;
    }
    for (const h of this.peer.messageHandlers) {
      h(payload);
    }
    return true;
  }
  onMessage(handler: (p: string) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }
  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
  isOpen(): boolean {
    return !this.closed;
  }
  close(): void {
    this.closed = true;
    for (const h of this.closeHandlers) {
      h();
    }
  }
}

/**
 * A mock responder peer connection (baby side). When the session opens the alert
 * channel, it creates a loopback pair and hands the PARENT end to `onParentChannel`
 * so the test can attach the real parent receiver to it.
 */
function makeBabyPc(
  onParentChannel: (channel: LoopbackDataChannel) => void,
): PeerConnection {
  const handlers: {
    [K in keyof PeerConnectionEvents]: Set<PeerConnectionEvents[K]>;
  } = {
    icecandidate: new Set(),
    connectionstatechange: new Set(),
    track: new Set(),
    datachannel: new Set(),
  };
  let remoteSet = false;
  return {
    createOffer: jest.fn(
      async (): Promise<SignalingSdp> => ({ type: 'offer', sdp: SRTP_SDP }),
    ),
    createAnswer: jest.fn(
      async (): Promise<SignalingSdp> => ({ type: 'answer', sdp: SRTP_SDP }),
    ),
    setRemoteDescription: jest.fn(async (): Promise<void> => {
      remoteSet = true;
    }),
    addIceCandidate: jest.fn(async (_c: SignalingIceCandidate) => {}),
    addAudioTrack: jest.fn(() => null),
    addVideoTrack: jest.fn(() => null),
    createDataChannel: jest.fn((label: string): DataChannel | null => {
      const babyCh = new LoopbackDataChannel(label);
      const parentCh = new LoopbackDataChannel(label);
      babyCh.peer = parentCh;
      parentCh.peer = babyCh;
      onParentChannel(parentCh);
      return babyCh;
    }),
    on<K extends keyof PeerConnectionEvents>(
      e: K,
      handler: PeerConnectionEvents[K],
    ) {
      handlers[e].add(handler);
      return () => handlers[e].delete(handler);
    },
    getConnectionState: () => 'connected' as PeerConnectionState,
    getStats: async () => new Map(),
    hasRemoteDescription: () => remoteSet,
    close: jest.fn(),
  };
}

function makeMediaDevices(): MediaDevicesLike {
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
  const stream: MediaStreamLike = {
    getTracks: () => [audio, video],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [video],
  };
  return { getUserMedia: jest.fn(async () => stream) };
}

function makeStubCrySource() {
  let listener: ((sample: CrySample) => void) | null = null;
  const source: CrySampleSource = onSample => {
    listener = onSample;
    return () => {
      listener = null;
    };
  };
  const emit = (sample: CrySample) => listener?.(sample);
  return { source, emit };
}

function sustainedCry(startMs = 0): CrySample[] {
  const out: CrySample[] = [];
  for (let i = 0; i < 70; i += 1) {
    out.push({ rms: 0.75, bandEnergyRatio: 0.7, timestamp: startMs + i * 100 });
  }
  return out;
}

function makeMultiClientTransport(): MultiClientSignalingTransport {
  return {
    onClientConnect() {
      return () => {};
    },
    async start() {},
    close() {},
  };
}

async function flush(times = 12): Promise<void> {
  await act(async () => {
    for (let i = 0; i < times; i++) {
      await Promise.resolve();
    }
  });
}

describe('DMY-77 cry → alert source → datachannel → parent receiver (end-to-end)', () => {
  beforeEach(() => {
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
    act(() => useAppStore.getState().setRole('baby'));
  });

  it('a sustained cry on the baby fires the parent notification + haptic with a privacy-safe cry payload', async () => {
    const { source: crySource, emit } = makeStubCrySource();

    // Parent-side sinks, wired EXACTLY as useMediaSession({ alertReceiver }) does.
    const present = jest.fn();
    const trigger = jest.fn();
    const presenter: AlertNotificationPresenter = { present };
    const haptic: HapticFeedback = { trigger };

    // The baby's real cry alert source (mounts useCryDetection).
    const { result: alertSource } = renderHook(() =>
      useCryAlertSource({ source: crySource }),
    );

    // When the responder session opens the channel, attach the parent receiver to
    // the loopback peer end — the production parent adapter, same options shape.
    const babyPc = makeBabyPc(parentChannel => {
      receiveAlertsFromChannel(parentChannel, { presenter, haptic });
    });

    // The real baby publish path (DMY-75): one fan-out, one responder per parent.
    const broadcast = createBabyBroadcast({
      sessionId: SID,
      transport: makeMultiClientTransport(),
      mediaDevices: makeMediaDevices(),
      createPeerConnection: () => babyPc,
      alertSource: alertSource.current,
    });
    await act(async () => {
      await broadcast.start();
    });
    const { a: perClient } = createLoopbackTransportPair();
    await act(async () => {
      await broadcast.addParent('p1', perClient);
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });

    // Raise a sustained cry on the baby.
    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });
    await flush();

    // The parent fired BOTH sinks exactly once for the one cry, with the
    // privacy-safe payload (type only; soundId stripped to '' on the wire).
    expect(present).toHaveBeenCalledTimes(1);
    expect(present.mock.calls[0][0]).toMatchObject({ type: 'cry' });
    expect(present.mock.calls[0][0].soundId).toBe('');
    expect(trigger).toHaveBeenCalledTimes(1);

    broadcast.stop();
  });

  it('no cry → no datachannel send → no parent alert (no false positives)', async () => {
    const { source: crySource, emit } = makeStubCrySource();
    const present = jest.fn();
    const trigger = jest.fn();

    const { result: alertSource } = renderHook(() =>
      useCryAlertSource({ source: crySource }),
    );
    const babyPc = makeBabyPc(parentChannel => {
      receiveAlertsFromChannel(parentChannel, {
        presenter: { present },
        haptic: { trigger },
      });
    });
    const broadcast = createBabyBroadcast({
      sessionId: SID,
      transport: makeMultiClientTransport(),
      mediaDevices: makeMediaDevices(),
      createPeerConnection: () => babyPc,
      alertSource: alertSource.current,
    });
    await act(async () => {
      await broadcast.start();
    });
    const { a: perClient } = createLoopbackTransportPair();
    await act(async () => {
      await broadcast.addParent('p1', perClient);
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });

    // A SUB-5s burst (~2s, 20 samples): below the cry continuity rule.
    act(() => {
      for (let i = 0; i < 20; i++) {
        emit({ rms: 0.75, bandEnergyRatio: 0.7, timestamp: i * 100 });
      }
    });
    await flush();

    // No cry was raised → nothing pushed → the parent sinks never fired.
    expect(present).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();

    broadcast.stop();
  });

  it('fans a single cry out to every connected parent (each gets its own notification)', async () => {
    const { source: crySource, emit } = makeStubCrySource();
    const presentCounts: number[] = [0, 0];

    const { result: alertSource } = renderHook(() =>
      useCryAlertSource({ source: crySource }),
    );

    let parentIndex = 0;
    const broadcast = createBabyBroadcast({
      sessionId: SID,
      transport: makeMultiClientTransport(),
      mediaDevices: makeMediaDevices(),
      createPeerConnection: () => {
        const idx = parentIndex;
        return makeBabyPc(parentChannel => {
          receiveAlertsFromChannel(parentChannel, {
            presenter: {
              present: () => {
                presentCounts[idx] += 1;
              },
            },
          });
        });
      },
      alertSource: alertSource.current,
    });
    await act(async () => {
      await broadcast.start();
    });
    await act(async () => {
      const { a: p1 } = createLoopbackTransportPair();
      parentIndex = 0;
      await broadcast.addParent('p1', p1);
      const { a: p2 } = createLoopbackTransportPair();
      parentIndex = 1;
      await broadcast.addParent('p2', p2);
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });
    await flush();

    // One cry reached BOTH parents' channels — each notified once.
    expect(presentCounts).toEqual([1, 1]);

    broadcast.stop();
  });

  it('a cry after a parent leaves reaches only the remaining parents (torn-down channel detaches, no stale delivery)', async () => {
    // Real night scenario: one parent closes the app mid-session while the baby
    // keeps detecting. removeParent → session.stop() must run the alert-channel
    // cleanup (the pushAlertsToChannel unsubscribe), so a LATER cry must not be
    // pushed to the gone parent's torn-down receiver — but must still fan out to
    // every parent that is still connected. Exercised through the live seams.
    const { source: crySource, emit } = makeStubCrySource();
    const presentCounts: number[] = [0, 0];

    const { result: alertSource } = renderHook(() =>
      useCryAlertSource({ source: crySource }),
    );

    let parentIndex = 0;
    const broadcast = createBabyBroadcast({
      sessionId: SID,
      transport: makeMultiClientTransport(),
      mediaDevices: makeMediaDevices(),
      createPeerConnection: () => {
        const idx = parentIndex;
        return makeBabyPc(parentChannel => {
          receiveAlertsFromChannel(parentChannel, {
            presenter: {
              present: () => {
                presentCounts[idx] += 1;
              },
            },
          });
        });
      },
      alertSource: alertSource.current,
    });
    await act(async () => {
      await broadcast.start();
    });
    await act(async () => {
      const { a: p1 } = createLoopbackTransportPair();
      parentIndex = 0;
      await broadcast.addParent('p1', p1);
      const { a: p2 } = createLoopbackTransportPair();
      parentIndex = 1;
      await broadcast.addParent('p2', p2);
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });

    // First cry while BOTH are connected: each parent notified once.
    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });
    await flush();
    expect(presentCounts).toEqual([1, 1]);

    // Parent p1 leaves the session (app closed / hung up).
    await act(async () => {
      broadcast.removeParent('p1');
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });

    // Clear the condition for >rearmClearMs (1.5s) so the detector re-arms, then
    // a SECOND, distinct cry episode fires.
    act(() => {
      for (let i = 0; i < 25; i++) {
        emit({ rms: 0.0, bandEnergyRatio: 0.0, timestamp: 7_000 + i * 100 });
      }
      for (const s of sustainedCry(60_000)) {
        emit(s);
      }
    });
    await flush();

    // The gone parent (p1) got NO new notification (its channel was torn down);
    // the remaining parent (p2) was notified for the second cry too.
    expect(presentCounts).toEqual([1, 2]);

    broadcast.stop();
  });
});
