/**
 * Unit tests for the video-stream helpers (DMY-17).
 *
 * Drives fake `mediaDevices` / streams / tracks / senders (no native WebRTC).
 * Asserts:
 *   - baby capture requests 1080p (`width:1920,height:1080`, rear camera) and
 *     steps DOWN through the ladder when the device cannot deliver it,
 *   - a non-constraint error (e.g. permission denied) is NOT retried,
 *   - the remote video stream is extracted only for real video tracks,
 *   - adaptive bitrate lowers the sender's encoding via setParameters (lower
 *     maxBitrate + higher scaleResolutionDownBy) WITHOUT recreating anything,
 *   - the quality ladder steps + clamps correctly and the connection-state
 *     bandwidth proxy maps as expected.
 */
import {
  BOTTOM_QUALITY_INDEX,
  TOP_QUALITY_INDEX,
  VIDEO_1080P_CONSTRAINTS,
  VIDEO_QUALITY_LADDER,
  bandwidthSignalForState,
  extractRemoteVideoStream,
  getLocalVideoStream,
  nextQualityIndex,
  setVideoBitrate,
  streamUrlOf,
  videoTracksOf,
} from '../videoStream';
import type {
  MediaDevicesLike,
  MediaStreamLike,
  MediaStreamTrackLike,
  RtpSendParametersLike,
  RtpSenderLike,
} from '../mediaTypes';

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

function overconstrained(): Error {
  const err = new Error('cannot satisfy width');
  err.name = 'OverconstrainedError';
  return err;
}

describe('getLocalVideoStream (1080p capture + degradation)', () => {
  it('requests 1080p from the rear camera (with audio)', async () => {
    const stream = fakeStream([fakeTrack('video'), fakeTrack('audio')]);
    const getUserMedia = jest.fn(async () => stream);
    const devices: MediaDevicesLike = { getUserMedia };

    const capture = await getLocalVideoStream(devices);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: true,
      video: VIDEO_1080P_CONSTRAINTS,
    });
    expect(VIDEO_1080P_CONSTRAINTS).toMatchObject({
      width: 1920,
      height: 1080,
      facingMode: 'environment',
    });
    expect(capture.stream).toBe(stream);
    expect(capture.degraded).toBe(false);
  });

  it('steps DOWN to 720p when 1080p is overconstrained', async () => {
    const stream720 = fakeStream([fakeTrack('video')]);
    const getUserMedia = jest
      .fn()
      .mockRejectedValueOnce(overconstrained())
      .mockResolvedValueOnce(stream720);
    const devices: MediaDevicesLike = { getUserMedia };

    const capture = await getLocalVideoStream(devices);

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    // Second attempt used the next (lower) rung — 1280x720.
    expect(getUserMedia.mock.calls[1][0].video).toMatchObject({
      width: 1280,
      height: 720,
    });
    expect(capture.stream).toBe(stream720);
    expect(capture.degraded).toBe(true);
    expect(capture.constraints.height).toBe(720);
  });

  it('does NOT retry a non-constraint error (e.g. permission denied)', async () => {
    const denied = new Error('NotAllowedError');
    denied.name = 'NotAllowedError';
    const getUserMedia = jest.fn(async () => {
      throw denied;
    });
    await expect(getLocalVideoStream({ getUserMedia })).rejects.toThrow(
      'NotAllowedError',
    );
    // Only the top rung was attempted — no step-down on a permission denial.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('throws when no mediaDevices is available', async () => {
    await expect(getLocalVideoStream(null)).rejects.toThrow(
      /no mediaDevices available/,
    );
  });

  it('re-throws when every rung is overconstrained', async () => {
    const getUserMedia = jest.fn(async () => {
      throw overconstrained();
    });
    await expect(getLocalVideoStream({ getUserMedia })).rejects.toThrow(
      /OverconstrainedError|cannot satisfy/,
    );
    expect(getUserMedia).toHaveBeenCalledTimes(VIDEO_QUALITY_LADDER.length);
  });
});

describe('videoTracksOf', () => {
  it('uses getVideoTracks when present', () => {
    const video = fakeTrack('video');
    const stream = fakeStream([fakeTrack('audio'), video]);
    expect(videoTracksOf(stream)).toEqual([video]);
  });

  it('falls back to filtering getTracks by kind', () => {
    const video = fakeTrack('video');
    const stream: MediaStreamLike = {
      getTracks: () => [fakeTrack('audio'), video],
    };
    expect(videoTracksOf(stream)).toEqual([video]);
  });
});

describe('extractRemoteVideoStream', () => {
  it('returns the stream from streams[0] when it has video', () => {
    const stream = fakeStream([fakeTrack('video')]);
    const event = { track: fakeTrack('video'), streams: [stream] };
    expect(extractRemoteVideoStream(event)).toBe(stream);
  });

  it('wraps a bare video track when no stream is present', () => {
    const track = fakeTrack('video');
    const result = extractRemoteVideoStream({ track });
    expect(result).not.toBeNull();
    expect(result?.getTracks()).toEqual([track]);
  });

  it('reads the receiver.track fallback', () => {
    const track = fakeTrack('video');
    const result = extractRemoteVideoStream({ receiver: { track } });
    expect(result?.getTracks()).toEqual([track]);
  });

  it('returns null for an audio-only track (not the video we want)', () => {
    const event = { track: fakeTrack('audio'), streams: [] };
    expect(extractRemoteVideoStream(event)).toBeNull();
  });

  it('returns null for null/empty events', () => {
    expect(extractRemoteVideoStream(null)).toBeNull();
    expect(extractRemoteVideoStream(undefined)).toBeNull();
    expect(extractRemoteVideoStream({})).toBeNull();
  });
});

describe('streamUrlOf', () => {
  it('returns the stream toURL()', () => {
    expect(streamUrlOf(fakeStream([fakeTrack('video')], 'rtc://abc'))).toBe(
      'rtc://abc',
    );
  });

  it('returns null when toURL is unavailable or for null', () => {
    expect(streamUrlOf(fakeStream([fakeTrack('video')]))).toBeNull();
    expect(streamUrlOf(null)).toBeNull();
  });
});

// --- Adaptive bitrate ------------------------------------------------------

function fakeSender(initial?: RtpSendParametersLike): RtpSenderLike & {
  setParameters: jest.Mock;
  applied: RtpSendParametersLike[];
} {
  const applied: RtpSendParametersLike[] = [];
  let params: RtpSendParametersLike = initial ?? { encodings: [{}] };
  const setParameters = jest.fn(async (p: RtpSendParametersLike) => {
    params = p;
    applied.push(p);
  });
  return {
    track: fakeTrack('video'),
    replaceTrack: jest.fn(async () => {}),
    getParameters: () => params,
    setParameters,
    applied,
  };
}

describe('setVideoBitrate (adaptive bitrate, no reconnect)', () => {
  it('lowers the encoding via setParameters (lower bitrate + higher downscale)', async () => {
    const sender = fakeSender();
    const high = VIDEO_QUALITY_LADDER[TOP_QUALITY_INDEX];
    const low = VIDEO_QUALITY_LADDER[BOTTOM_QUALITY_INDEX];

    expect(await setVideoBitrate(sender, high)).toBe(true);
    const afterHigh = sender.applied[0].encodings![0];
    expect(afterHigh.maxBitrate).toBe(high.maxBitrate);
    expect(afterHigh.scaleResolutionDownBy).toBe(1);

    expect(await setVideoBitrate(sender, low)).toBe(true);
    const afterLow = sender.applied[1].encodings![0];
    // The shed: lower bitrate cap and a larger downscale divisor.
    expect(afterLow.maxBitrate).toBeLessThan(high.maxBitrate);
    expect(afterLow.scaleResolutionDownBy).toBeGreaterThan(1);
    // maintain-framerate degradation preference is set.
    expect(sender.applied[1].degradationPreference).toBe('maintain-framerate');
  });

  it('replaceTrack is NEVER called — the connection is not re-created', async () => {
    const sender = fakeSender();
    await setVideoBitrate(sender, VIDEO_QUALITY_LADDER[BOTTOM_QUALITY_INDEX]);
    // Adaptive bitrate only reshapes encoding params; it must not touch the
    // track/transceiver (which would imply renegotiation / a media interruption).
    expect(sender.replaceTrack).not.toHaveBeenCalled();
    expect(sender.setParameters).toHaveBeenCalledTimes(1);
  });

  it('synthesises an encoding when the sender reports none', async () => {
    const sender = fakeSender({ encodings: [] });
    expect(await setVideoBitrate(sender, VIDEO_QUALITY_LADDER[0])).toBe(true);
    expect(sender.applied[0].encodings).toHaveLength(1);
    expect(sender.applied[0].encodings![0].maxBitrate).toBe(
      VIDEO_QUALITY_LADDER[0].maxBitrate,
    );
  });

  it('returns false for a null sender (nothing to shape)', async () => {
    expect(await setVideoBitrate(null, VIDEO_QUALITY_LADDER[0])).toBe(false);
  });

  it('swallows a setParameters rejection (never crashes the session)', async () => {
    const sender = fakeSender();
    sender.setParameters.mockRejectedValueOnce(new Error('boom'));
    expect(await setVideoBitrate(sender, VIDEO_QUALITY_LADDER[0])).toBe(false);
  });
});

describe('nextQualityIndex (ladder stepping + clamping)', () => {
  it('steps down toward low and clamps at the bottom', () => {
    expect(nextQualityIndex(TOP_QUALITY_INDEX, 'down')).toBe(1);
    expect(nextQualityIndex(BOTTOM_QUALITY_INDEX, 'down')).toBe(
      BOTTOM_QUALITY_INDEX,
    );
  });

  it('steps up toward high and clamps at the top', () => {
    expect(nextQualityIndex(BOTTOM_QUALITY_INDEX, 'up')).toBe(
      BOTTOM_QUALITY_INDEX - 1,
    );
    expect(nextQualityIndex(TOP_QUALITY_INDEX, 'up')).toBe(TOP_QUALITY_INDEX);
  });
});

describe('bandwidthSignalForState (connection-state proxy)', () => {
  it('maps disconnected -> low, connected -> ok, others -> hold', () => {
    expect(bandwidthSignalForState('disconnected')).toBe('low');
    expect(bandwidthSignalForState('connected')).toBe('ok');
    expect(bandwidthSignalForState('connecting')).toBe('hold');
    expect(bandwidthSignalForState('new')).toBe('hold');
  });
});
