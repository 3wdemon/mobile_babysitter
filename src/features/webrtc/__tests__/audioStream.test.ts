/**
 * Unit tests for the audio-stream capture/routing helpers (DMY-18).
 *
 * Drives fake `mediaDevices` / streams / tracks (no native WebRTC). Asserts:
 *   - baby capture requests audio-only (`{ audio: true, video: false }`) — the
 *     camera is never requested,
 *   - track stop / enabled toggling (mute) behave and release the mic,
 *   - the remote audio stream is extracted only for real audio tracks,
 *   - the DTLS-SRTP encrypted-profile assertion accepts SRTP and rejects
 *     plaintext RTP — proving the encryption is reflected in code/tests.
 */
import {
  AUDIO_ONLY_CONSTRAINTS,
  assertEncryptedMediaProfile,
  audioTracksOf,
  extractRemoteAudioStream,
  getLocalAudioStream,
  setStreamAudioEnabled,
  stopStream,
} from '../audioStream';
import type {
  MediaDevicesLike,
  MediaStreamLike,
  MediaStreamTrackLike,
} from '../mediaTypes';

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

describe('getLocalAudioStream', () => {
  it('requests audio-only (video explicitly disabled)', async () => {
    const stream = fakeStream([fakeTrack('audio')]);
    const getUserMedia = jest.fn(async () => stream);
    const devices: MediaDevicesLike = { getUserMedia };

    const result = await getLocalAudioStream(devices);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(AUDIO_ONLY_CONSTRAINTS).toEqual({ audio: true, video: false });
    expect(result).toBe(stream);
  });

  it('throws when no mediaDevices is available', async () => {
    await expect(getLocalAudioStream(null)).rejects.toThrow(
      /no mediaDevices available/,
    );
  });

  it('propagates a getUserMedia rejection (e.g. mic permission denied)', async () => {
    const devices: MediaDevicesLike = {
      getUserMedia: jest.fn(async () => {
        throw new Error('NotAllowedError');
      }),
    };
    await expect(getLocalAudioStream(devices)).rejects.toThrow(
      'NotAllowedError',
    );
  });
});

describe('audioTracksOf', () => {
  it('uses getAudioTracks when present', () => {
    const audio = fakeTrack('audio');
    const stream = fakeStream([audio, fakeTrack('video')]);
    expect(audioTracksOf(stream)).toEqual([audio]);
  });

  it('falls back to filtering getTracks by kind', () => {
    const audio = fakeTrack('audio');
    const stream: MediaStreamLike = {
      getTracks: () => [audio, fakeTrack('video')],
    };
    expect(audioTracksOf(stream)).toEqual([audio]);
  });
});

describe('stopStream', () => {
  it('stops every track (releases the mic)', () => {
    const a = fakeTrack('audio');
    const v = fakeTrack('video');
    stopStream(fakeStream([a, v]));
    expect(a.stop).toHaveBeenCalledTimes(1);
    expect(v.stop).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for null/undefined', () => {
    expect(() => stopStream(null)).not.toThrow();
    expect(() => stopStream(undefined)).not.toThrow();
  });

  it('continues stopping after one track throws', () => {
    const bad = fakeTrack('audio');
    bad.stop.mockImplementation(() => {
      throw new Error('boom');
    });
    const good = fakeTrack('audio');
    expect(() => stopStream(fakeStream([bad, good]))).not.toThrow();
    expect(good.stop).toHaveBeenCalled();
  });
});

describe('setStreamAudioEnabled (mute/unmute)', () => {
  it('toggles enabled on every audio track and returns the count', () => {
    const a1 = fakeTrack('audio');
    const a2 = fakeTrack('audio');
    const v = fakeTrack('video');
    const stream = fakeStream([a1, a2, v]);

    expect(setStreamAudioEnabled(stream, false)).toBe(2);
    expect(a1.enabled).toBe(false);
    expect(a2.enabled).toBe(false);
    // Video untouched.
    expect(v.enabled).toBe(true);

    expect(setStreamAudioEnabled(stream, true)).toBe(2);
    expect(a1.enabled).toBe(true);
    expect(a2.enabled).toBe(true);
  });

  it('is a no-op for null', () => {
    expect(setStreamAudioEnabled(null, false)).toBe(0);
  });
});

describe('extractRemoteAudioStream', () => {
  it('returns the stream from streams[0] when it has audio', () => {
    const stream = fakeStream([fakeTrack('audio')]);
    const event = { track: fakeTrack('audio'), streams: [stream] };
    expect(extractRemoteAudioStream(event)).toBe(stream);
  });

  it('wraps a bare audio track when no stream is present', () => {
    const track = fakeTrack('audio');
    const result = extractRemoteAudioStream({ track });
    expect(result).not.toBeNull();
    expect(result?.getTracks()).toEqual([track]);
  });

  it('reads the receiver.track fallback', () => {
    const track = fakeTrack('audio');
    const result = extractRemoteAudioStream({ receiver: { track } });
    expect(result?.getTracks()).toEqual([track]);
  });

  it('returns null for a video-only track (not the audio we want)', () => {
    const event = { track: fakeTrack('video'), streams: [] };
    expect(extractRemoteAudioStream(event)).toBeNull();
  });

  it('returns null for null/empty events', () => {
    expect(extractRemoteAudioStream(null)).toBeNull();
    expect(extractRemoteAudioStream(undefined)).toBeNull();
    expect(extractRemoteAudioStream({})).toBeNull();
  });
});

describe('assertEncryptedMediaProfile (DTLS-SRTP)', () => {
  it('reports encrypted for a real WebRTC SRTP audio m-line', () => {
    const sdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
    ].join('\n');
    const result = assertEncryptedMediaProfile(sdp);
    expect(result.encrypted).toBe(true);
    expect(result.profiles).toEqual(['UDP/TLS/RTP/SAVPF']);
  });

  it('accepts the RTP/SAVPF profile token too', () => {
    const sdp = 'm=audio 9 RTP/SAVPF 111';
    expect(assertEncryptedMediaProfile(sdp).encrypted).toBe(true);
  });

  it('reports NOT encrypted for plaintext RTP/AVP (which WebRTC refuses)', () => {
    const sdp = 'm=audio 9 RTP/AVP 0';
    const result = assertEncryptedMediaProfile(sdp);
    expect(result.encrypted).toBe(false);
    expect(result.profiles).toEqual(['RTP/AVP']);
  });

  it('reports NOT encrypted when any m-line is plaintext', () => {
    const sdp = [
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'm=video 9 RTP/AVP 96',
    ].join('\n');
    expect(assertEncryptedMediaProfile(sdp).encrypted).toBe(false);
  });

  it('reports NOT encrypted for empty/missing SDP (nothing to secure)', () => {
    expect(assertEncryptedMediaProfile(null).encrypted).toBe(false);
    expect(assertEncryptedMediaProfile('').encrypted).toBe(false);
    expect(
      assertEncryptedMediaProfile('v=0\no=- 0 0 IN IP4 0.0.0.0').encrypted,
    ).toBe(false);
  });
});
