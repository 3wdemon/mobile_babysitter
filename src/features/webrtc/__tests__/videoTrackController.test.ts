/**
 * Unit tests for the video-track controller wrapper (DMY-24).
 *
 * Verifies the no-op default is harmless, a real controller's calls are
 * forwarded, and a throwing controller can never crash the caller (errors are
 * swallowed + logged).
 */
import {
  createSafeVideoTrackController,
  noopVideoTrackController,
} from '../videoTrackController';
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
