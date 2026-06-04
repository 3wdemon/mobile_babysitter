/**
 * Unit tests for useMediaSession (DMY-45, part 2) — the combined audio+video
 * media session over ONE peer connection.
 *
 * Uses the real store (MMKV mocked), a loopback transport, a mock peer
 * connection, fake mediaDevices + sender + playback, and an injectable
 * bandwidth source. Asserts:
 *   - baby captures once (camera+mic) and publishes BOTH an audio track and a
 *     video track onto the SAME connection, exposing the real video controller;
 *   - parent routes a remote AUDIO track to playback (playing=true) and a remote
 *     VIDEO track to remoteStreamUrl (hasRemoteVideo=true) — never fabricated;
 *   - an adaptive-bitrate signal reshapes the sender WITHOUT re-creating the
 *     connection (AC #2);
 *   - cleanup releases camera+mic on unmount (AC #3, no capture leak).
 */
import { act, renderHook } from '@testing-library/react-native';
import { NativeModules, Platform } from 'react-native';

import { useMediaSession } from '../useMediaSession';
import type { AndroidAudioService } from '../androidAudioService';
import { useAppStore } from '../../../store/useAppStore';
import { createLoopbackTransportPair } from '../signalingTransport';
import { VIDEO_QUALITY_LADDER } from '../videoStream';
import type {
  BandwidthSignal,
  BandwidthSignalSource,
} from '../videoStream';
import type { AudioPlayback } from '../audioPlayback';
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

const SRTP_SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
].join('\r\n');

function fakeTrack(kind: 'audio' | 'video'): MediaStreamTrackLike & {
  stop: jest.Mock;
} {
  return { kind, enabled: true, stop: jest.fn() };
}

function fakeStream(tracks: MediaStreamTrackLike[], url?: string): MediaStreamLike {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
    ...(url ? { toURL: () => url } : {}),
  };
}

function fakeSender(): RtpSenderLike & { setParameters: jest.Mock } {
  let params: RtpSendParametersLike = { encodings: [{}] };
  return {
    track: fakeTrack('video'),
    replaceTrack: jest.fn(async () => {}),
    getParameters: () => params,
    setParameters: jest.fn(async (p: RtpSendParametersLike) => {
      params = p;
    }),
  };
}

class MockPeerConnection implements PeerConnection {
  state: PeerConnectionState = 'new';
  remoteSet = false;
  readonly sender = fakeSender();
  addAudioTrack = jest.fn();
  addVideoTrack = jest.fn(() => this.sender);
  private readonly handlers: {
    [K in keyof PeerConnectionEvents]: Set<PeerConnectionEvents[K]>;
  } = {
    icecandidate: new Set(),
    connectionstatechange: new Set(),
    track: new Set(),
    datachannel: new Set(),
  };
  createOffer = jest.fn(async (): Promise<SignalingSdp> => ({ type: 'offer', sdp: SRTP_SDP }));
  createAnswer = jest.fn(async (): Promise<SignalingSdp> => ({ type: 'answer', sdp: SRTP_SDP }));
  setRemoteDescription = jest.fn(async () => {
    this.remoteSet = true;
  });
  addIceCandidate = jest.fn(async (_c: SignalingIceCandidate) => {});
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
  async getStats(): Promise<unknown> {
    return new Map();
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
      for (const l of listeners) l(signal);
    },
  };
}

function fakePlayback(): AudioPlayback & { start: jest.Mock; stop: jest.Mock } {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    setMuted: jest.fn(),
    setRoute: jest.fn(),
    getAvailableRoutes: jest.fn(() => ['speaker' as const]),
    setVolume: jest.fn(),
  } as unknown as AudioPlayback & { start: jest.Mock; stop: jest.Mock };
}

function fakeForegroundAudio(): AndroidAudioService & {
  start: jest.Mock;
  stop: jest.Mock;
} {
  return { start: jest.fn(), stop: jest.fn() };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

describe('useMediaSession', () => {
  beforeEach(() => {
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
  });

  it('baby: publishes BOTH audio and video on one connection and exposes a real video controller', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-m1');
    });
    const audioTrack = fakeTrack('audio');
    const videoTrack = fakeTrack('video');
    const stream = fakeStream([audioTrack, videoTrack]);
    const mediaDevices: MediaDevicesLike = {
      getUserMedia: jest.fn(async () => stream),
    };
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useMediaSession({
        transport: b,
        createPeerConnection: () => pc,
        mediaDevices,
      }),
    );
    await flush();

    expect(pc.addAudioTrack).toHaveBeenCalledTimes(1);
    expect(pc.addVideoTrack).toHaveBeenCalledTimes(1);
    expect(result.current.videoController).not.toBeNull();
  });

  it('parent: a remote AUDIO track starts playback; a remote VIDEO track exposes the stream URL', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-m2');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const playback = fakePlayback();
    const { result } = renderHook(() =>
      useMediaSession({ transport: a, createPeerConnection: () => pc, playback }),
    );
    await flush();

    // Remote audio arrives.
    act(() => pc.emitTrack({ track: fakeTrack('audio'), streams: [fakeStream([fakeTrack('audio')])] }));
    expect(playback.start).toHaveBeenCalledTimes(1);
    expect(result.current.playing).toBe(true);
    expect(result.current.hasRemoteAudio).toBe(true);

    // Remote video arrives.
    act(() =>
      pc.emitTrack({
        track: fakeTrack('video'),
        streams: [fakeStream([fakeTrack('video')], 'stream://remote-1')],
      }),
    );
    expect(result.current.hasRemoteVideo).toBe(true);
    expect(result.current.remoteStreamUrl).toBe('stream://remote-1');
  });

  it('parent: hasRemoteVideo stays false with no real track (never fabricated)', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-m3');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useMediaSession({ transport: a, createPeerConnection: () => pc }),
    );
    await flush();
    expect(result.current.hasRemoteVideo).toBe(false);
    expect(result.current.remoteStreamUrl).toBeNull();
    expect(result.current.playing).toBe(false);
  });

  it('baby: a low bandwidth signal lowers the bitrate WITHOUT re-creating the connection (AC #2)', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-m4');
    });
    const stream = fakeStream([fakeTrack('audio'), fakeTrack('video')]);
    const mediaDevices: MediaDevicesLike = { getUserMedia: jest.fn(async () => stream) };
    const bandwidth = makeBandwidth();
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    renderHook(() =>
      useMediaSession({
        transport: b,
        createPeerConnection: () => pc,
        mediaDevices,
        bandwidth,
      }),
    );
    await flush();
    const createCalls = pc.createAnswer.mock.calls.length;

    await act(async () => {
      bandwidth.push('low');
      await Promise.resolve();
    });

    const lastParams = pc.sender.setParameters.mock.calls.at(-1)?.[0] as
      | RtpSendParametersLike
      | undefined;
    expect(lastParams?.encodings?.[0].maxBitrate).toBe(
      VIDEO_QUALITY_LADDER[1].maxBitrate,
    );
    // No renegotiation / new connection — the same pc, no extra answer.
    expect(pc.createAnswer.mock.calls.length).toBe(createCalls);
    expect(pc.close).not.toHaveBeenCalled();
  });

  it('baby: releases camera + mic on unmount (no capture leak, AC #3)', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-m5');
    });
    const audioTrack = fakeTrack('audio');
    const videoTrack = fakeTrack('video');
    const stream = fakeStream([audioTrack, videoTrack]);
    const mediaDevices: MediaDevicesLike = { getUserMedia: jest.fn(async () => stream) };
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { unmount } = renderHook(() =>
      useMediaSession({ transport: b, createPeerConnection: () => pc, mediaDevices }),
    );
    await flush();

    act(() => unmount());
    expect(audioTrack.stop).toHaveBeenCalled();
    expect(videoTrack.stop).toHaveBeenCalled();
  });

  it('parent: starts the Android foreground audio service when remote audio attaches (DMY-23)', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-fg1');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const foregroundAudioService = fakeForegroundAudio();
    renderHook(() =>
      useMediaSession({
        transport: a,
        createPeerConnection: () => pc,
        foregroundAudioService,
      }),
    );
    await flush();

    expect(foregroundAudioService.start).not.toHaveBeenCalled();

    act(() =>
      pc.emitTrack({
        track: fakeTrack('audio'),
        streams: [fakeStream([fakeTrack('audio')])],
      }),
    );

    expect(foregroundAudioService.start).toHaveBeenCalledTimes(1);
    expect(foregroundAudioService.stop).not.toHaveBeenCalled();
  });

  it('parent: does NOT start the foreground service for a video-only track', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-fg2');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const foregroundAudioService = fakeForegroundAudio();
    renderHook(() =>
      useMediaSession({
        transport: a,
        createPeerConnection: () => pc,
        foregroundAudioService,
      }),
    );
    await flush();

    act(() =>
      pc.emitTrack({
        track: fakeTrack('video'),
        streams: [fakeStream([fakeTrack('video')], 'stream://v')],
      }),
    );

    expect(foregroundAudioService.start).not.toHaveBeenCalled();
  });

  it('parent: stops the foreground audio service on unmount (no orphaned notification, DMY-23)', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-fg3');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const foregroundAudioService = fakeForegroundAudio();
    const { unmount } = renderHook(() =>
      useMediaSession({
        transport: a,
        createPeerConnection: () => pc,
        foregroundAudioService,
      }),
    );
    await flush();
    act(() =>
      pc.emitTrack({
        track: fakeTrack('audio'),
        streams: [fakeStream([fakeTrack('audio')])],
      }),
    );

    act(() => unmount());

    expect(foregroundAudioService.stop).toHaveBeenCalled();
  });

  it('parent: stops the foreground audio service on a mid-session teardown (bye) while still mounted (DMY-23)', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-fg4');
    });
    const { a, b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const foregroundAudioService = fakeForegroundAudio();
    const { result } = renderHook(() =>
      useMediaSession({
        transport: a,
        createPeerConnection: () => pc,
        foregroundAudioService,
      }),
    );
    await flush();

    // Remote audio attaches: the foreground service starts and playback is live.
    act(() =>
      pc.emitTrack({
        track: fakeTrack('audio'),
        streams: [fakeStream([fakeTrack('audio')])],
      }),
    );
    expect(foregroundAudioService.start).toHaveBeenCalledTimes(1);
    expect(result.current.playing).toBe(true);
    expect(foregroundAudioService.stop).not.toHaveBeenCalled();

    // The peer cleanly hangs up (`bye`) — a normal end of session, NOT an
    // unmount. The active→inactive transition must tear the foreground service
    // down and stop playback (the stop path covered here is the in-`playing`
    // branch, distinct from the unmount safety net).
    await act(async () => {
      await b.connect();
      b.send({ type: 'bye', sessionId: 'sess-fg4', from: 'responder' });
      for (let i = 0; i < 8; i++) {
        await Promise.resolve();
      }
    });

    expect(foregroundAudioService.stop).toHaveBeenCalledTimes(1);
    expect(result.current.playing).toBe(false);
  });

  // --- iOS background-audio session wiring (DMY-74) ------------------------
  //
  // An explicitly-injected playback controller (a test fake here) must be driven
  // exactly like the production one: start() on remote audio, stop() on teardown.
  // This is the seam the iOS AVAudioSession controller (DMY-48) plugs into, and
  // it must keep working regardless of platform so tests stay deterministic.
  it('parent: an injected playback is activated on remote audio and deactivated on unmount (DMY-74)', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-ios1');
    });
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const playback = fakePlayback();
    const { unmount } = renderHook(() =>
      useMediaSession({ transport: a, createPeerConnection: () => pc, playback }),
    );
    await flush();

    expect(playback.start).not.toHaveBeenCalled();

    act(() =>
      pc.emitTrack({
        track: fakeTrack('audio'),
        streams: [fakeStream([fakeTrack('audio')])],
      }),
    );
    expect(playback.start).toHaveBeenCalledTimes(1);

    act(() => unmount());
    expect(playback.stop).toHaveBeenCalled();
  });

  describe('iOS platform default (DMY-74)', () => {
    const originalOS = Platform.OS;

    function mockAudioSession(): { activate: jest.Mock; deactivate: jest.Mock } {
      return {
        activate: jest.fn(async () => {}),
        deactivate: jest.fn(async () => {}),
      };
    }

    afterEach(() => {
      Platform.OS = originalOS;
      delete (NativeModules as Record<string, unknown>).AudioSessionModule;
    });

    it('parent on iOS: activates the AVAudioSession on remote audio and deactivates on teardown (bye)', async () => {
      Platform.OS = 'ios';
      const native = mockAudioSession();
      (NativeModules as Record<string, unknown>).AudioSessionModule = native;

      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-ios2');
      });
      const { a, b } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      // No `playback` injected: the hook must resolve the iOS default itself.
      const { result } = renderHook(() =>
        useMediaSession({ transport: a, createPeerConnection: () => pc }),
      );
      await flush();
      expect(native.activate).not.toHaveBeenCalled();

      act(() =>
        pc.emitTrack({
          track: fakeTrack('audio'),
          streams: [fakeStream([fakeTrack('audio')])],
        }),
      );
      await flush();
      expect(native.activate).toHaveBeenCalledTimes(1);
      expect(result.current.playing).toBe(true);

      // A clean hang-up (`bye`) must release the session (AC3, mic indicator).
      await act(async () => {
        await b.connect();
        b.send({ type: 'bye', sessionId: 'sess-ios2', from: 'responder' });
        for (let i = 0; i < 8; i++) {
          await Promise.resolve();
        }
      });
      expect(native.deactivate).toHaveBeenCalledTimes(1);
      expect(result.current.playing).toBe(false);
    });

    it('parent on Android: never touches the iOS AVAudioSession (no regression)', async () => {
      // Even with a module registered, resolveAudioSessionModule returns undefined
      // off iOS, so the platform default stays the safe no-op.
      Platform.OS = 'android';
      const native = mockAudioSession();
      (NativeModules as Record<string, unknown>).AudioSessionModule = native;

      act(() => {
        useAppStore.getState().setRole('parent');
        useAppStore.getState().setPaired('sess-ios3');
      });
      const { a } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const { unmount } = renderHook(() =>
        useMediaSession({ transport: a, createPeerConnection: () => pc }),
      );
      await flush();

      act(() =>
        pc.emitTrack({
          track: fakeTrack('audio'),
          streams: [fakeStream([fakeTrack('audio')])],
        }),
      );
      await flush();
      act(() => unmount());

      expect(native.activate).not.toHaveBeenCalled();
      expect(native.deactivate).not.toHaveBeenCalled();
    });

    it('baby on iOS: NEVER activates the AVAudioSession (baby publishes, it does not play back)', async () => {
      // The platform default is resolved inside the hook regardless of role, so
      // a baby device on iOS also constructs the iOS controller. But the baby
      // PUBLISHES audio and never plays a remote track back, so activate() must
      // never fire — otherwise the baby would grab a .playAndRecord session and
      // light the mic indicator for the wrong reason. Constructing the controller
      // is side-effect-free; only a remote-track attach (parent-only) activates.
      Platform.OS = 'ios';
      const native = mockAudioSession();
      (NativeModules as Record<string, unknown>).AudioSessionModule = native;

      act(() => {
        useAppStore.getState().setRole('baby');
        useAppStore.getState().setPaired('sess-ios-baby');
      });
      const stream = fakeStream([fakeTrack('audio'), fakeTrack('video')]);
      const mediaDevices: MediaDevicesLike = {
        getUserMedia: jest.fn(async () => stream),
      };
      const { b } = createLoopbackTransportPair();
      const pc = new MockPeerConnection();
      const { unmount } = renderHook(() =>
        useMediaSession({
          transport: b,
          createPeerConnection: () => pc,
          mediaDevices,
        }),
      );
      await flush();

      // Even if a track event reaches the baby, onRemoteTrack early-returns for
      // the baby role, so playback is never started.
      act(() =>
        pc.emitTrack({
          track: fakeTrack('audio'),
          streams: [fakeStream([fakeTrack('audio')])],
        }),
      );
      await flush();
      act(() => unmount());

      // The session is NEVER activated on the baby. The harmless idempotent
      // deactivate() on unmount is acceptable (releasing a session that was
      // never held is a no-op); the load-bearing guarantee is no activate().
      expect(native.activate).not.toHaveBeenCalled();
    });
  });

  // --- Two-way talk wired into the live session (DMY-76) -------------------
  //
  // The live parent screen uses THIS hook, not useAudioStream — so push-to-talk
  // must work here. With enableTalkback the parent (initiator) captures its own
  // mic (echo-cancelled) and publishes a DISABLED talk track onto the SAME peer
  // connection; startTalking enables it, stopTalking disables it, and teardown
  // releases the mic. `talking`/`talkReady` are driven by the REAL track, never
  // fabricated.
  it('parent: enableTalkback captures the mic and publishes a DISABLED talk track on the live pc (DMY-76)', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-talk1');
    });
    const talkTrack = fakeTrack('audio');
    const talkStream = fakeStream([talkTrack]);
    const mediaDevices: MediaDevicesLike = {
      getUserMedia: jest.fn(async () => talkStream),
    };
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useMediaSession({
        transport: a,
        createPeerConnection: () => pc,
        mediaDevices,
        enableTalkback: true,
      }),
    );
    await flush();

    // The parent mic was captured with echo-cancelling constraints and the talk
    // track was published onto the SAME peer connection (parent→baby m-line).
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    const constraints = (mediaDevices.getUserMedia as jest.Mock).mock
      .calls[0][0];
    expect(constraints.audio).toMatchObject({ echoCancellation: true });
    expect(pc.addAudioTrack).toHaveBeenCalledWith(talkTrack, talkStream);
    // Default-off (push-to-talk): the published track is DISABLED until held.
    expect(talkTrack.enabled).toBe(false);
    expect(result.current.talkbackEnabled).toBe(true);
    expect(result.current.talkReady).toBe(true);
    expect(result.current.talking).toBe(false);
  });

  it('parent: startTalking enables the talk track, stopTalking disables it (push-to-talk, DMY-76)', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-talk2');
    });
    const talkTrack = fakeTrack('audio');
    const talkStream = fakeStream([talkTrack]);
    const mediaDevices: MediaDevicesLike = {
      getUserMedia: jest.fn(async () => talkStream),
    };
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useMediaSession({
        transport: a,
        createPeerConnection: () => pc,
        mediaDevices,
        enableTalkback: true,
      }),
    );
    await flush();

    // Hold the talk button: the real outgoing track goes live.
    act(() => result.current.startTalking());
    expect(talkTrack.enabled).toBe(true);
    expect(result.current.talking).toBe(true);

    // Release: silence is sent again (half-duplex).
    act(() => result.current.stopTalking());
    expect(talkTrack.enabled).toBe(false);
    expect(result.current.talking).toBe(false);
  });

  it('parent: releases the talk mic on unmount (no capture leak, DMY-76)', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-talk3');
    });
    const talkTrack = fakeTrack('audio');
    const talkStream = fakeStream([talkTrack]);
    const mediaDevices: MediaDevicesLike = {
      getUserMedia: jest.fn(async () => talkStream),
    };
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { unmount } = renderHook(() =>
      useMediaSession({
        transport: a,
        createPeerConnection: () => pc,
        mediaDevices,
        enableTalkback: true,
      }),
    );
    await flush();

    act(() => unmount());
    expect(talkTrack.stop).toHaveBeenCalled();
  });

  it('parent: WITHOUT enableTalkback the parent publishes nothing and the talk controls are inert (DMY-76)', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-talk4');
    });
    const mediaDevices: MediaDevicesLike = {
      getUserMedia: jest.fn(async () => fakeStream([fakeTrack('audio')])),
    };
    const { a } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useMediaSession({
        transport: a,
        createPeerConnection: () => pc,
        mediaDevices,
      }),
    );
    await flush();

    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(pc.addAudioTrack).not.toHaveBeenCalled();
    expect(result.current.talkbackEnabled).toBe(false);
    expect(result.current.talkReady).toBe(false);
    // Controls are safe no-ops (no controller acquired) — never fabricate.
    act(() => result.current.startTalking());
    expect(result.current.talking).toBe(false);
  });

  it('baby: enableTalkback is ignored (the baby captures via the broadcast fan-out, DMY-76)', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-talk5');
    });
    const audioTrack = fakeTrack('audio');
    const videoTrack = fakeTrack('video');
    const stream = fakeStream([audioTrack, videoTrack]);
    const mediaDevices: MediaDevicesLike = {
      getUserMedia: jest.fn(async () => stream),
    };
    const { b } = createLoopbackTransportPair();
    const pc = new MockPeerConnection();
    const { result } = renderHook(() =>
      useMediaSession({
        transport: b,
        createPeerConnection: () => pc,
        mediaDevices,
        enableTalkback: true,
      }),
    );
    await flush();

    // The baby path publishes its OWN capture (audio+video), not a talk track,
    // and never reports talkReady.
    expect(pc.addVideoTrack).toHaveBeenCalledTimes(1);
    expect(result.current.talkReady).toBe(false);
  });

  it('stays inert with no transport (never fabricates a session)', () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().setPaired('sess-m6');
    });
    const { result } = renderHook(() => useMediaSession());
    expect(result.current.isActive).toBe(false);
    expect(result.current.playing).toBe(false);
  });
});
