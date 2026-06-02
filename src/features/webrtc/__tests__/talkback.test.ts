/**
 * Unit tests for talkback (DMY-20) — the parent→baby push-to-talk primitives.
 *
 * Asserts (against fakes, no native dependency):
 *   - the talk capture requests native echo cancellation (echoCancellation +
 *     noiseSuppression + autoGainControl) and never the camera,
 *   - the push-to-talk controller is DEFAULT-OFF (track disabled): nothing is
 *     transmitted until startTalking,
 *   - startTalking enables the track, stopTalking disables it (half-duplex —
 *     the mic is "open" only while talking),
 *   - dispose stops the mic track (no capture leak) and is idempotent,
 *   - no audio content / track ids are logged.
 */
import {
  TALK_AUDIO_CONSTRAINTS,
  createTalkbackController,
  getTalkbackAudioStream,
  requestsEchoCancellation,
} from '../talkback';
import type {
  MediaDevicesLike,
  MediaStreamConstraints,
  MediaStreamLike,
  MediaStreamTrackLike,
} from '../mediaTypes';

function fakeTrack(kind: 'audio' | 'video'): MediaStreamTrackLike & {
  stop: jest.Mock;
} {
  // Start enabled to PROVE the controller disables it by default.
  return { kind, enabled: true, stop: jest.fn() };
}

function fakeStream(tracks: MediaStreamTrackLike[]): MediaStreamLike {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
  };
}

describe('TALK_AUDIO_CONSTRAINTS', () => {
  it('requests native echo cancellation, noise suppression and AGC, no camera', () => {
    expect(TALK_AUDIO_CONSTRAINTS.video).toBe(false);
    expect(TALK_AUDIO_CONSTRAINTS.audio).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  it('requestsEchoCancellation is true for the talk constraints, false otherwise', () => {
    expect(requestsEchoCancellation(TALK_AUDIO_CONSTRAINTS)).toBe(true);
    expect(requestsEchoCancellation({ audio: true, video: false })).toBe(false);
    expect(
      requestsEchoCancellation({
        audio: { echoCancellation: false },
        video: false,
      }),
    ).toBe(false);
  });
});

describe('getTalkbackAudioStream', () => {
  it('captures with echo-cancelling constraints (echoCancellation:true)', async () => {
    const stream = fakeStream([fakeTrack('audio')]);
    const getUserMedia = jest.fn(
      async (_constraints: MediaStreamConstraints) => stream,
    );
    const mediaDevices: MediaDevicesLike = { getUserMedia };

    const result = await getTalkbackAudioStream(mediaDevices);

    expect(result).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(TALK_AUDIO_CONSTRAINTS);
    expect(requestsEchoCancellation(TALK_AUDIO_CONSTRAINTS)).toBe(true);
  });

  it('throws when no mediaDevices is available (no native module)', async () => {
    await expect(getTalkbackAudioStream(null)).rejects.toThrow(
      /no mediaDevices/i,
    );
  });
});

describe('createTalkbackController (push-to-talk)', () => {
  it('is default-off: the talk track is DISABLED until startTalking', () => {
    const track = fakeTrack('audio');
    const controller = createTalkbackController(fakeStream([track]));

    // Default-off: nothing is transmitted out of the parent mic.
    expect(controller.talking).toBe(false);
    expect(track.enabled).toBe(false);
  });

  it('startTalking enables the track, stopTalking disables it', () => {
    const track = fakeTrack('audio');
    const changes: boolean[] = [];
    const controller = createTalkbackController(fakeStream([track]), t =>
      changes.push(t),
    );

    controller.startTalking();
    expect(controller.talking).toBe(true);
    expect(track.enabled).toBe(true);

    controller.stopTalking();
    expect(controller.talking).toBe(false);
    expect(track.enabled).toBe(false);

    // onTalkingChange fired for each real transition.
    expect(changes).toEqual([true, false]);
  });

  it('coalesces redundant transitions (no duplicate callbacks)', () => {
    const track = fakeTrack('audio');
    const changes: boolean[] = [];
    const controller = createTalkbackController(fakeStream([track]), t =>
      changes.push(t),
    );

    controller.startTalking();
    controller.startTalking(); // redundant
    controller.stopTalking();
    controller.stopTalking(); // redundant

    expect(changes).toEqual([true, false]);
  });

  it('half-duplex: the mic is enabled ONLY while talking', () => {
    const track = fakeTrack('audio');
    const controller = createTalkbackController(fakeStream([track]));

    // Before / between talks the track is disabled (closed mic).
    expect(track.enabled).toBe(false);
    controller.startTalking();
    expect(track.enabled).toBe(true);
    controller.stopTalking();
    expect(track.enabled).toBe(false);
  });

  it('dispose stops the mic track (no capture leak) and is idempotent', () => {
    const track = fakeTrack('audio');
    const controller = createTalkbackController(fakeStream([track]));

    controller.startTalking();
    controller.dispose();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(controller.talking).toBe(false);

    // Idempotent + inert after dispose.
    controller.dispose();
    controller.startTalking();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(controller.talking).toBe(false);
  });

  it('never logs audio content or track ids', () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const spies = {
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    };
    try {
      const track = fakeTrack('audio');
      const controller = createTalkbackController(fakeStream([track]));
      controller.startTalking();
      controller.stopTalking();
      controller.dispose();

      const text = Object.values(spies)
        .flatMap(s => s.mock.calls.map(c => JSON.stringify(c)))
        .join('\n');
      // Coarse boolean facts are fine; raw audio markers must never appear.
      expect(text).not.toContain('opus');
      expect(text).not.toContain('SAVPF');
    } finally {
      Object.values(spies).forEach(s => s.mockRestore());
    }
  });
});
