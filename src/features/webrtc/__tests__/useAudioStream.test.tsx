/**
 * Unit tests for useAudioStream (DMY-18) — the baby→parent audio path.
 *
 * Uses the real store (MMKV mocked in-memory), a loopback transport, a mock
 * PeerConnection factory, a fake mediaDevices and a spy AudioPlayback. Asserts:
 *   - baby captures audio-only (`{audio:true,video:false}`, no camera) and adds
 *     the audio track to the peer; the parent never captures,
 *   - parent attaches a REAL remote audio track to playback (`playing` only from
 *     a genuine ontrack — never fabricated),
 *   - mute/unmute toggles the playback + remote track enabled flag,
 *   - cleanup stops the mic tracks and playback on unmount (no leak),
 *   - the DTLS-SRTP encrypted-media assertion is surfaced from the local SDP,
 *   - no audio content / SDP is logged.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useAudioStream } from '../useAudioStream';
import { useAppStore } from '../../../store/useAppStore';
import { createLoopbackTransportPair } from '../signalingTransport';
import { logger } from '../../../services/logger';
import type { AudioPlayback } from '../audioPlayback';
import type {
  MediaDevicesLike,
  MediaStreamLike,
  MediaStreamTrackLike,
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

const SRTP_SDP =
  'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n';

class MockPeerConnection implements PeerConnection {
  state: PeerConnectionState = 'new';
  remoteSet = false;
  readonly addedTracks: Array<{
    track: MediaStreamTrackLike;
    stream: MediaStreamLike;
  }> = [];
  private readonly handlers: {
    [K in keyof PeerConnectionEvents]: Set<PeerConnectionEvents[K]>;
  } = {
    icecandidate: new Set(),
    connectionstatechange: new Set(),
    track: new Set(),
  };
  createOffer = jest.fn(async (): Promise<SignalingSdp> => {
    return { type: 'offer', sdp: SRTP_SDP };
  });
  createAnswer = jest.fn(async (): Promise<SignalingSdp> => {
    return { type: 'answer', sdp: SRTP_SDP };
  });
  setRemoteDescription = jest.fn(async () => {
    this.remoteSet = true;
  });
  addIceCandidate = jest.fn(async (_c: SignalingIceCandidate) => {});
  addAudioTrack = jest.fn(
    (track: MediaStreamTrackLike, stream: MediaStreamLike) => {
      this.addedTracks.push({ track, stream });
    },
  );
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
  emitTrack(event: unknown): void {
    for (const h of this.handlers.track) {
      h(event);
    }
  }
}

function fakeTrack(kind: 'audio' | 'video'): MediaStreamTrackLike & {
  stop: jest.Mock;
} {
  return { kind, enabled: true, stop: jest.fn() };
}

function fakeStream(tracks: MediaStreamTrackLike[]): MediaStreamLike {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
  };
}

function spyPlayback(): AudioPlayback & {
  start: jest.Mock;
  stop: jest.Mock;
  setMuted: jest.Mock;
  setRoute: jest.Mock;
} {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    setMuted: jest.fn(),
    // DMY-55 / DMY-56 seam additions; unused by the audio-stream lifecycle tests.
    setVolume: jest.fn(),
    setRoute: jest.fn(),
    isBluetoothAvailable: jest.fn(() => false),
    getAvailableRoutes: jest.fn(() => ['speaker', 'earpiece'] as const),
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

describe('useAudioStream', () => {
  beforeEach(() => {
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
  });

  it('baby captures audio-only and publishes the audio track to the peer (no camera)', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-baby');
    });
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const audio = fakeTrack('audio');
    const stream = fakeStream([audio]);
    const getUserMedia = jest.fn(async () => stream);
    const mediaDevices: MediaDevicesLike = { getUserMedia };

    renderHook(() =>
      useAudioStream({
        transport: b,
        createPeerConnection: () => pc,
        mediaDevices,
      }),
    );
    await flush();

    // Audio-only capture: video MUST be false (camera never powered up).
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    // The audio track was published onto the peer connection.
    expect(pc.addAudioTrack).toHaveBeenCalledTimes(1);
    expect(pc.addedTracks[0].track).toBe(audio);
  });

  it('parent does not capture any media', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-parent');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const getUserMedia = jest.fn(async () => fakeStream([fakeTrack('audio')]));

    renderHook(() =>
      useAudioStream({
        transport: a,
        createPeerConnection: () => pc,
        mediaDevices: { getUserMedia },
      }),
    );
    await flush();

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(pc.addAudioTrack).not.toHaveBeenCalled();
  });

  it('parent attaches a REAL remote audio track to playback (playing only from ontrack)', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-p2');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const playback = spyPlayback();

    const { result } = renderHook(() =>
      useAudioStream({
        transport: a,
        createPeerConnection: () => pc,
        playback,
      }),
    );
    await flush();

    // No remote track yet → NOT playing (never fabricated).
    expect(result.current.playing).toBe(false);
    expect(result.current.hasRemoteAudio).toBe(false);
    expect(playback.start).not.toHaveBeenCalled();

    // A genuine remote audio track arrives.
    const remote = fakeStream([fakeTrack('audio')]);
    act(() => pc.emitTrack({ track: fakeTrack('audio'), streams: [remote] }));

    expect(playback.start).toHaveBeenCalledWith(remote);
    expect(result.current.playing).toBe(true);
    expect(result.current.hasRemoteAudio).toBe(true);
  });

  it('a non-audio (video) remote track does NOT mark playing', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-p3');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const playback = spyPlayback();
    const { result } = renderHook(() =>
      useAudioStream({
        transport: a,
        createPeerConnection: () => pc,
        playback,
      }),
    );
    await flush();

    act(() => pc.emitTrack({ track: fakeTrack('video'), streams: [] }));
    expect(playback.start).not.toHaveBeenCalled();
    expect(result.current.playing).toBe(false);
  });

  it('mute/unmute toggles the playback and the remote track enabled flag', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-mute');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const playback = spyPlayback();
    const { result } = renderHook(() =>
      useAudioStream({
        transport: a,
        createPeerConnection: () => pc,
        playback,
      }),
    );
    await flush();

    const audio = fakeTrack('audio');
    const remote = fakeStream([audio]);
    act(() => pc.emitTrack({ track: audio, streams: [remote] }));
    // Attached unmuted by default.
    expect(audio.enabled).toBe(true);

    act(() => result.current.setMuted(true));
    expect(result.current.muted).toBe(true);
    expect(playback.setMuted).toHaveBeenLastCalledWith(true);

    act(() => result.current.setMuted(false));
    expect(result.current.muted).toBe(false);
    expect(playback.setMuted).toHaveBeenLastCalledWith(false);
  });

  it('attaches a remote track muted when initiallyMuted is set', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-im');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useAudioStream({
        transport: a,
        createPeerConnection: () => pc,
        playback: spyPlayback(),
        initiallyMuted: true,
      }),
    );
    await flush();

    const audio = fakeTrack('audio');
    act(() => pc.emitTrack({ track: audio, streams: [fakeStream([audio])] }));
    expect(result.current.muted).toBe(true);
    // The remote track is disabled (muted) on attach.
    expect(audio.enabled).toBe(false);
  });

  it('stops the local mic tracks and playback on unmount (no leak)', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-cleanup');
    });
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const audio = fakeTrack('audio');
    const stream = fakeStream([audio]);
    const mediaDevices: MediaDevicesLike = {
      getUserMedia: jest.fn(async () => stream),
    };

    const { unmount } = renderHook(() =>
      useAudioStream({
        transport: b,
        createPeerConnection: () => pc,
        mediaDevices,
      }),
    );
    await flush();
    expect(audio.stop).not.toHaveBeenCalled();

    unmount();
    // The microphone track was stopped — no capture leak.
    expect(audio.stop).toHaveBeenCalledTimes(1);
    expect(pc.close).toHaveBeenCalled();
  });

  it('releases playback when an active session is stopped', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-stop');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const playback = spyPlayback();
    const { result } = renderHook(() =>
      useAudioStream({
        transport: a,
        createPeerConnection: () => pc,
        playback,
        autoStart: false,
      }),
    );
    await flush();
    act(() => result.current.start());
    await flush();
    const audio = fakeTrack('audio');
    act(() => pc.emitTrack({ track: audio, streams: [fakeStream([audio])] }));
    expect(result.current.playing).toBe(true);

    act(() => result.current.stop());
    await flush();
    expect(playback.stop).toHaveBeenCalled();
    expect(result.current.playing).toBe(false);
    expect(result.current.hasRemoteAudio).toBe(false);
  });

  it('baby ignores a stray remote track (does not mark playing)', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-baby2');
    });
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const playback = spyPlayback();
    const audio = fakeTrack('audio');
    const { result } = renderHook(() =>
      useAudioStream({
        transport: b,
        createPeerConnection: () => pc,
        mediaDevices: {
          getUserMedia: jest.fn(async () => fakeStream([audio])),
        },
        playback,
      }),
    );
    await flush();
    act(() => pc.emitTrack({ track: fakeTrack('audio'), streams: [] }));
    expect(playback.start).not.toHaveBeenCalled();
    expect(result.current.playing).toBe(false);
  });

  it('surfaces the DTLS-SRTP encrypted-media profile from the negotiated SDP', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-srtp');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useAudioStream({
        transport: a,
        createPeerConnection: () => pc,
        playback: spyPlayback(),
      }),
    );
    await flush();

    // The negotiated local SDP uses the SRTP profile → media is encrypted.
    expect(result.current.mediaEncrypted?.encrypted).toBe(true);
    expect(result.current.mediaEncrypted?.profiles).toContain(
      'UDP/TLS/RTP/SAVPF',
    );
  });

  it('stays inert (no capture, no session) with no transport', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-inert');
    });
    const pc = new MockPeerConnection();
    const getUserMedia = jest.fn();
    const { result } = renderHook(() =>
      useAudioStream({
        createPeerConnection: () => pc,
        mediaDevices: { getUserMedia },
      }),
    );
    await flush();
    expect(result.current.isActive).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(pc.addAudioTrack).not.toHaveBeenCalled();
  });

  // --- Two-way talk: parent→baby push-to-talk + echo cancellation (DMY-20) ---
  describe('two-way talk (push-to-talk)', () => {
    it('parent captures its mic with echo cancellation and publishes a DISABLED talk track', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-talk-cap');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const talk = fakeTrack('audio');
      const stream = fakeStream([talk]);
      const getUserMedia = jest.fn(async () => stream);

      renderHook(() =>
        useAudioStream({
          transport: a,
          createPeerConnection: () => pc,
          mediaDevices: { getUserMedia },
          playback: spyPlayback(),
          enableTalkback: true,
        }),
      );
      await flush();

      // Echo cancellation requested (native AEC), camera never powered up.
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(getUserMedia).toHaveBeenCalledWith({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      // The talk track was published onto the SAME peer connection...
      expect(pc.addAudioTrack).toHaveBeenCalledTimes(1);
      expect(pc.addedTracks[0].track).toBe(talk);
      // ...but is DISABLED by default — nothing is transmitted until talk.
      expect(talk.enabled).toBe(false);
    });

    it('parent does NOT capture a talk mic when talkback is disabled (one-way)', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-talk-off');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const getUserMedia = jest.fn(async () =>
        fakeStream([fakeTrack('audio')]),
      );

      renderHook(() =>
        useAudioStream({
          transport: a,
          createPeerConnection: () => pc,
          mediaDevices: { getUserMedia },
          playback: spyPlayback(),
          // enableTalkback omitted → false
        }),
      );
      await flush();

      expect(getUserMedia).not.toHaveBeenCalled();
      expect(pc.addAudioTrack).not.toHaveBeenCalled();
    });

    it('startTalking enables the talk track; stopTalking disables it', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-ptt');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const talk = fakeTrack('audio');
      const { result } = renderHook(() =>
        useAudioStream({
          transport: a,
          createPeerConnection: () => pc,
          mediaDevices: {
            getUserMedia: jest.fn(async () => fakeStream([talk])),
          },
          playback: spyPlayback(),
          enableTalkback: true,
        }),
      );
      await flush();

      // Default-off.
      expect(result.current.talking).toBe(false);
      expect(talk.enabled).toBe(false);

      act(() => result.current.startTalking());
      expect(result.current.talking).toBe(true);
      expect(talk.enabled).toBe(true);

      act(() => result.current.stopTalking());
      expect(result.current.talking).toBe(false);
      expect(talk.enabled).toBe(false);
    });

    it('baby plays the parent push-to-talk audio on a real ontrack', async () => {
      act(() => {
        useAppStore.getState().setRole('baby');
        useAppStore.getState().setPaired('sess-baby-talk');
      });
      const { b } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const playback = spyPlayback();
      const babyMic = fakeTrack('audio');
      const { result } = renderHook(() =>
        useAudioStream({
          transport: b,
          createPeerConnection: () => pc,
          mediaDevices: {
            getUserMedia: jest.fn(async () => fakeStream([babyMic])),
          },
          playback,
          enableTalkback: true,
        }),
      );
      await flush();

      // No parent voice yet → not playing.
      expect(result.current.playing).toBe(false);

      // The parent's push-to-talk voice arrives over the same connection.
      const parentVoice = fakeStream([fakeTrack('audio')]);
      act(() =>
        pc.emitTrack({ track: fakeTrack('audio'), streams: [parentVoice] }),
      );

      expect(playback.start).toHaveBeenCalledWith(parentVoice);
      expect(result.current.playing).toBe(true);
      expect(result.current.hasRemoteAudio).toBe(true);
    });

    it('talk controls are inert no-ops before the talk capture is ready', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-talk-inert');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      // Never resolves → controller is never acquired.
      const getUserMedia = jest.fn(
        () => new Promise<MediaStreamLike>(() => {}),
      );
      const { result } = renderHook(() =>
        useAudioStream({
          transport: a,
          createPeerConnection: () => pc,
          mediaDevices: { getUserMedia },
          playback: spyPlayback(),
          enableTalkback: true,
        }),
      );
      await flush();

      // Calling the controls must not throw or fabricate a talking state.
      act(() => result.current.startTalking());
      expect(result.current.talking).toBe(false);
    });

    it('disposes the talk capture (stops the mic) on unmount — no leak', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-talk-cleanup');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const talk = fakeTrack('audio');
      const { result, unmount } = renderHook(() =>
        useAudioStream({
          transport: a,
          createPeerConnection: () => pc,
          mediaDevices: {
            getUserMedia: jest.fn(async () => fakeStream([talk])),
          },
          playback: spyPlayback(),
          enableTalkback: true,
        }),
      );
      await flush();
      act(() => result.current.startTalking());
      expect(talk.stop).not.toHaveBeenCalled();

      unmount();
      // The parent talk mic was stopped — no capture leak.
      expect(talk.stop).toHaveBeenCalledTimes(1);
    });

    it('stops the talk capture when an active session is stopped', async () => {
      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-talk-stop');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const talk = fakeTrack('audio');
      const { result } = renderHook(() =>
        useAudioStream({
          transport: a,
          createPeerConnection: () => pc,
          mediaDevices: {
            getUserMedia: jest.fn(async () => fakeStream([talk])),
          },
          playback: spyPlayback(),
          enableTalkback: true,
          autoStart: false,
        }),
      );
      await flush();
      act(() => result.current.start());
      await flush();
      act(() => result.current.startTalking());
      expect(result.current.talking).toBe(true);

      act(() => result.current.stop());
      await flush();
      expect(talk.stop).toHaveBeenCalledTimes(1);
      expect(result.current.talking).toBe(false);
    });
  });

  it('never logs audio content or the raw SDP', async () => {
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
        useAppStore.getState().setPaired('sess-priv');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const { result } = renderHook(() =>
        useAudioStream({
          transport: a,
          createPeerConnection: () => pc,
          playback: spyPlayback(),
        }),
      );
      await flush();
      const audio = fakeTrack('audio');
      act(() => pc.emitTrack({ track: audio, streams: [fakeStream([audio])] }));
      // Also exercise an explicit logger call site for completeness.
      logger.info('audio diag', { sdp: SRTP_SDP });

      const text = Object.values(spies)
        .flatMap(s => s.mock.calls.map(c => JSON.stringify(c)))
        .join('\n');
      // The SRTP SDP body (opus rtpmap) must never appear in the clear.
      expect(text).not.toContain('opus/48000/2');
      expect(text).not.toContain('UDP/TLS/RTP/SAVPF');
      expect(result.current.playing).toBe(true);
    } finally {
      Object.values(spies).forEach(s => s.mockRestore());
    }
  });
});
