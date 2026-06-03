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
