/**
 * Unit tests for the video-track controller wrapper (DMY-24).
 *
 * Verifies the no-op default is harmless, a real controller's calls are
 * forwarded, and a throwing controller can never crash the caller (errors are
 * swallowed + logged).
 */
import {
  createSafeVideoTrackController,
  createSenderVideoTrackController,
  noopVideoTrackController,
} from '../videoTrackController';
import type {
  MediaStreamTrackLike,
  RtpSenderLike,
  RtpTransceiverLike,
} from '../mediaTypes';
import type { VideoTrackController } from '../types';

describe('videoTrackController', () => {
  it('no-op controller does not throw on enable/disable', () => {
    expect(() => {
      noopVideoTrackController.enableVideo();
      noopVideoTrackController.disableVideo();
    }).not.toThrow();
  });

  it('default wrapped controller (no arg) does not throw', () => {
    const safe = createSafeVideoTrackController();
    expect(() => {
      safe.enableVideo();
      safe.disableVideo();
    }).not.toThrow();
  });

  it('forwards enable/disable to the injected controller', () => {
    const enableVideo = jest.fn();
    const disableVideo = jest.fn();
    const controller: VideoTrackController = { enableVideo, disableVideo };

    const safe = createSafeVideoTrackController(controller);
    safe.enableVideo();
    safe.disableVideo();

    expect(enableVideo).toHaveBeenCalledTimes(1);
    expect(disableVideo).toHaveBeenCalledTimes(1);
  });

  it('swallows errors from a throwing controller (never propagates)', () => {
    const controller: VideoTrackController = {
      enableVideo: () => {
        throw new Error('boom');
      },
      disableVideo: () => {
        throw new Error('boom');
      },
    };

    const safe = createSafeVideoTrackController(controller);
    expect(() => {
      safe.enableVideo();
      safe.disableVideo();
    }).not.toThrow();
  });
});

// --- Real sender-backed controller (DMY-17, replaces the no-op) -------------

function fakeTrack(): MediaStreamTrackLike {
  return { kind: 'video', enabled: true, stop: jest.fn() };
}

function fakeSender(): RtpSenderLike & { replaceTrack: jest.Mock } {
  return {
    track: fakeTrack(),
    replaceTrack: jest.fn(async () => {}),
    getParameters: () => ({ encodings: [{}] }),
    setParameters: jest.fn(async () => {}),
  };
}

describe('createSenderVideoTrackController (real, sender-backed)', () => {
  it('disableVideo pauses the outgoing track (replaceTrack(null)) — no video sent', () => {
    const sender = fakeSender();
    const track = fakeTrack();
    const controller = createSenderVideoTrackController({ sender, track });

    controller.disableVideo();

    // The send side is genuinely paused — null track means no frames go out.
    expect(sender.replaceTrack).toHaveBeenCalledWith(null);
  });

  it('enableVideo restores the captured track (replaceTrack(track))', () => {
    const sender = fakeSender();
    const track = fakeTrack();
    const controller = createSenderVideoTrackController({ sender, track });

    controller.enableVideo();

    expect(sender.replaceTrack).toHaveBeenCalledWith(track);
  });

  it('flips the transceiver direction sendonly/inactive when provided', () => {
    const sender = fakeSender();
    const track = fakeTrack();
    const transceiver: RtpTransceiverLike = { direction: 'sendonly', sender };
    const controller = createSenderVideoTrackController({
      sender,
      track,
      transceiver,
    });

    controller.disableVideo();
    expect(transceiver.direction).toBe('inactive');

    controller.enableVideo();
    expect(transceiver.direction).toBe('sendonly');
  });

  it('is NOT a no-op: a spy sender observes real calls', () => {
    const sender = fakeSender();
    const controller = createSenderVideoTrackController({
      sender,
      track: fakeTrack(),
    });
    controller.enableVideo();
    controller.disableVideo();
    expect(sender.replaceTrack).toHaveBeenCalledTimes(2);
  });

  it('tolerates a missing sender (no throw)', () => {
    const controller = createSenderVideoTrackController({
      sender: null,
      track: fakeTrack(),
    });
    expect(() => {
      controller.enableVideo();
      controller.disableVideo();
    }).not.toThrow();
  });

  it('swallows a replaceTrack rejection (never an unhandled rejection)', async () => {
    const sender = fakeSender();
    sender.replaceTrack.mockRejectedValue(new Error('boom'));
    const controller = createSenderVideoTrackController({
      sender,
      track: fakeTrack(),
    });
    expect(() => controller.disableVideo()).not.toThrow();
    // Let the rejected promise settle; the .catch guard must absorb it.
    await Promise.resolve();
    await Promise.resolve();
  });
});
