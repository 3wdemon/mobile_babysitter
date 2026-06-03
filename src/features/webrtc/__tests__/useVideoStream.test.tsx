/**
 * Unit tests for useVideoStream (DMY-17) — the baby→parent video path.
 *
 * Uses the real store (MMKV mocked in-memory), a loopback transport, a mock
 * PeerConnection factory, a fake mediaDevices, a fake video sender, and an
 * injectable bandwidth source. Asserts the AC:
 *   - baby captures 1080p (rear camera) and publishes the video track sendonly,
 *   - parent attaches a REAL remote video stream for RTCView (`hasRemoteVideo`
 *     only from a genuine ontrack — never fabricated),
 *   - a bandwidth-shortage signal lowers the sender's bitrate via setParameters,
 *     and the connection is NEVER re-created (no disconnect),
 *   - the real sender-backed VideoTrackController is exposed (not a no-op),
 *   - cleanup stops the camera on unmount/stop (no capture leak), idempotently,
 *   - the DTLS-SRTP encrypted-media assertion is surfaced (covers the video
 *     m-line),
 *   - no video content / SDP is logged.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useVideoStream } from '../useVideoStream';
import { useAppStore } from '../../../store/useAppStore';
import { createLoopbackTransportPair } from '../signalingTransport';
import { logger } from '../../../services/logger';
import { VIDEO_QUALITY_LADDER } from '../videoStream';
import type {
  BandwidthSignal,
  BandwidthSignalSource,
} from '../videoStream';
import type {
  MediaDevicesLike,
  MediaStreamLike,
  MediaStreamTrackLike,
  RtpSendParametersLike,
  RtpSenderLike,
} from '../mediaTypes';
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

// SRTP SDP with BOTH an audio and a video m-line — proves the video media line
// is covered by the encryption assertion.
const SRTP_SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=rtpmap:96 H264/90000',
].join('\r\n');

function fakeTrack(kind: 'audio' | 'video'): MediaStreamTrackLike & {
  stop: jest.Mock;
} {
  return { kind, enabled: true, stop: jest.fn() };
}

function fakeStream(
  tracks: MediaStreamTrackLike[],
  url?: string,
): MediaStreamLike {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
    ...(url ? { toURL: () => url } : {}),
  };
}

function fakeSender(): RtpSenderLike & {
  replaceTrack: jest.Mock;
  setParameters: jest.Mock;
  applied: RtpSendParametersLike[];
} {
  const applied: RtpSendParametersLike[] = [];
  let params: RtpSendParametersLike = { encodings: [{}] };
  return {
    track: fakeTrack('video'),
    replaceTrack: jest.fn(async () => {}),
    getParameters: () => params,
    setParameters: jest.fn(async (p: RtpSendParametersLike) => {
      params = p;
      applied.push(p);
    }),
    applied,
  };
}

class MockPeerConnection implements PeerConnection {
  state: PeerConnectionState = 'new';
  remoteSet = false;
  readonly sender = fakeSender();
  addVideoTrackCalls = 0;
  private readonly handlers: {
    [K in keyof PeerConnectionEvents]: Set<PeerConnectionEvents[K]>;
  } = {
    icecandidate: new Set(),
    connectionstatechange: new Set(),
    track: new Set(),
    datachannel: new Set(),
  };
  createOffer = jest.fn(
    async (): Promise<SignalingSdp> => ({ type: 'offer', sdp: SRTP_SDP }),
  );
  createAnswer = jest.fn(
    async (): Promise<SignalingSdp> => ({ type: 'answer', sdp: SRTP_SDP }),
  );
  setRemoteDescription = jest.fn(async () => {
    this.remoteSet = true;
  });
  addIceCandidate = jest.fn(async (_c: SignalingIceCandidate) => {});
  addAudioTrack = jest.fn();
  addVideoTrack = jest.fn(
    (_track: MediaStreamTrackLike, _stream: MediaStreamLike) => {
      this.addVideoTrackCalls += 1;
      return this.sender;
    },
  );
  createDataChannel = jest.fn(() => null);
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
  emitTrack(event: unknown): void {
    for (const h of this.handlers.track) {
      h(event);
    }
  }
}

/** A driveable bandwidth source the test pushes synthetic signals through. */
function makeBandwidth(): BandwidthSignalSource & {
  push: (s: BandwidthSignal) => void;
} {
  const listeners = new Set<(s: BandwidthSignal) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(signal) {
      for (const l of listeners) {
        l(signal);
      }
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

describe('useVideoStream', () => {
  beforeEach(() => {
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
  });

  it('baby captures 1080p and publishes the video track to the peer (sendonly)', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-v-baby');
    });
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const video = fakeTrack('video');
    const stream = fakeStream([video, fakeTrack('audio')]);
    const getUserMedia = jest.fn(async () => stream);
    const mediaDevices: MediaDevicesLike = { getUserMedia };

    renderHook(() =>
      useVideoStream({
        transport: b,
        createPeerConnection: () => pc,
        mediaDevices,
      }),
    );
    await flush();

    // 1080p rear-camera capture.
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: true,
      video: expect.objectContaining({
        width: 1920,
        height: 1080,
        facingMode: 'environment',
      }),
    });
    // The video track was published onto the peer connection.
    expect(pc.addVideoTrack).toHaveBeenCalledTimes(1);
    expect(pc.addVideoTrack.mock.calls[0][0]).toBe(video);
  });

  it('exposes the REAL sender-backed VideoTrackController (not a no-op)', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-v-ctrl');
    });
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useVideoStream({
        transport: b,
        createPeerConnection: () => pc,
        mediaDevices: {
          getUserMedia: jest.fn(async () => fakeStream([fakeTrack('video')])),
        },
      }),
    );
    await flush();

    expect(result.current.videoController).not.toBeNull();
    // disableVideo really pauses the outgoing track on the real sender.
    act(() => result.current.videoController!.disableVideo());
    expect(pc.sender.replaceTrack).toHaveBeenLastCalledWith(null);
    act(() => result.current.videoController!.enableVideo());
    // enableVideo restores the captured track.
    expect(pc.sender.replaceTrack).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'video' }),
    );
  });

  it('parent attaches a REAL remote video stream for RTCView (hasRemoteVideo only from ontrack)', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-v-parent');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useVideoStream({ transport: a, createPeerConnection: () => pc }),
    );
    await flush();

    // No remote track yet → no video (never fabricated).
    expect(result.current.hasRemoteVideo).toBe(false);
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.remoteStreamUrl).toBeNull();
    // The parent publishes nothing.
    expect(pc.addVideoTrack).not.toHaveBeenCalled();

    const remote = fakeStream([fakeTrack('video')], 'rtc://remote-1');
    act(() => pc.emitTrack({ track: fakeTrack('video'), streams: [remote] }));

    expect(result.current.hasRemoteVideo).toBe(true);
    expect(result.current.remoteStream).toBe(remote);
    expect(result.current.remoteStreamUrl).toBe('rtc://remote-1');
  });

  it('an audio-only remote track does NOT mark video present', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-v-audio');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useVideoStream({ transport: a, createPeerConnection: () => pc }),
    );
    await flush();

    act(() => pc.emitTrack({ track: fakeTrack('audio'), streams: [] }));
    expect(result.current.hasRemoteVideo).toBe(false);
  });

  it('lowers the bitrate on a bandwidth-shortage signal WITHOUT re-creating the connection', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-v-bw');
    });
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const bandwidth = makeBandwidth();
    const { result } = renderHook(() =>
      useVideoStream({
        transport: b,
        createPeerConnection: () => pc,
        mediaDevices: {
          getUserMedia: jest.fn(async () => fakeStream([fakeTrack('video')])),
        },
        bandwidth,
      }),
    );
    await flush();

    // Starts at the top rung.
    expect(result.current.quality.name).toBe('high');
    const setParamsBefore = pc.sender.setParameters.mock.calls.length;

    // Bandwidth drops → step DOWN.
    act(() => bandwidth.push('low'));
    await flush();

    expect(result.current.quality.name).toBe('medium');
    // setParameters was called again with a LOWER cap.
    expect(pc.sender.setParameters.mock.calls.length).toBeGreaterThan(
      setParamsBefore,
    );
    const lastParams = pc.sender.applied[pc.sender.applied.length - 1];
    expect(lastParams.encodings![0].maxBitrate).toBe(
      VIDEO_QUALITY_LADDER[1].maxBitrate,
    );
    expect(lastParams.encodings![0].maxBitrate).toBeLessThan(
      VIDEO_QUALITY_LADDER[0].maxBitrate,
    );

    // THE KEY ASSERTION: no disconnect — the connection was never closed or
    // recreated; only the encoding changed.
    expect(pc.close).not.toHaveBeenCalled();
    expect(pc.addVideoTrackCalls).toBe(1);
    expect(pc.createOffer).not.toHaveBeenCalled(); // baby answers, never re-offers

    // Recovery → step back UP.
    act(() => bandwidth.push('ok'));
    await flush();
    expect(result.current.quality.name).toBe('high');
    expect(pc.close).not.toHaveBeenCalled();
  });

  it('steps down repeatedly and clamps at the lowest rung', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-v-clamp');
    });
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const bandwidth = makeBandwidth();
    const { result } = renderHook(() =>
      useVideoStream({
        transport: b,
        createPeerConnection: () => pc,
        mediaDevices: {
          getUserMedia: jest.fn(async () => fakeStream([fakeTrack('video')])),
        },
        bandwidth,
      }),
    );
    await flush();

    for (let i = 0; i < 5; i++) {
      act(() => bandwidth.push('low'));
      await flush();
    }
    expect(result.current.quality.name).toBe('low');
    expect(pc.close).not.toHaveBeenCalled();
  });

  it('stops the camera on unmount (no capture leak)', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-v-cleanup');
    });
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const video = fakeTrack('video');
    const audio = fakeTrack('audio');
    const stream = fakeStream([video, audio]);
    const { unmount } = renderHook(() =>
      useVideoStream({
        transport: b,
        createPeerConnection: () => pc,
        mediaDevices: { getUserMedia: jest.fn(async () => stream) },
      }),
    );
    await flush();
    expect(video.stop).not.toHaveBeenCalled();

    unmount();
    // The camera (video) track was stopped — no capture leak.
    expect(video.stop).toHaveBeenCalledTimes(1);
    expect(audio.stop).toHaveBeenCalledTimes(1);
  });

  it('cleanup is idempotent (stop then unmount does not double-stop or throw)', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-v-idem');
    });
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const video = fakeTrack('video');
    const stream = fakeStream([video]);
    const { result, unmount } = renderHook(() =>
      useVideoStream({
        transport: b,
        createPeerConnection: () => pc,
        mediaDevices: { getUserMedia: jest.fn(async () => stream) },
        autoStart: false,
      }),
    );
    await flush();
    act(() => result.current.start());
    await flush();

    act(() => result.current.stop());
    await flush();
    expect(video.stop).toHaveBeenCalledTimes(1);

    // A second teardown via unmount must not stop the (already-released) track
    // again, and must not throw.
    expect(() => unmount()).not.toThrow();
    expect(video.stop).toHaveBeenCalledTimes(1);
  });

  it('surfaces the DTLS-SRTP encrypted-media profile including the video m-line', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-v-srtp');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useVideoStream({ transport: a, createPeerConnection: () => pc }),
    );
    await flush();

    expect(result.current.mediaEncrypted?.encrypted).toBe(true);
    // Both the audio AND the video m-line are SRTP.
    expect(result.current.mediaEncrypted?.profiles).toEqual([
      'UDP/TLS/RTP/SAVPF',
      'UDP/TLS/RTP/SAVPF',
    ]);
  });

  it('stays inert (no capture) with no transport', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-v-inert');
    });
    const pc = new MockPeerConnection();
    const getUserMedia = jest.fn();
    const { result } = renderHook(() =>
      useVideoStream({
        createPeerConnection: () => pc,
        mediaDevices: { getUserMedia },
      }),
    );
    await flush();
    expect(result.current.isActive).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(pc.addVideoTrack).not.toHaveBeenCalled();
  });

  it('never logs video content or the raw SDP', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const spies = {
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    };
    try {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-v-priv');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const { result } = renderHook(() =>
        useVideoStream({ transport: a, createPeerConnection: () => pc }),
      );
      await flush();
      act(() =>
        pc.emitTrack({
          track: fakeTrack('video'),
          streams: [fakeStream([fakeTrack('video')], 'rtc://x')],
        }),
      );
      logger.info('video diag', { sdp: SRTP_SDP });

      const text = Object.values(spies)
        .flatMap(s => s.mock.calls.map(c => JSON.stringify(c)))
        .join('\n');
      expect(text).not.toContain('H264/90000');
      expect(text).not.toContain('UDP/TLS/RTP/SAVPF');
      expect(result.current.hasRemoteVideo).toBe(true);
    } finally {
      Object.values(spies).forEach(s => s.mockRestore());
    }
  });
});
