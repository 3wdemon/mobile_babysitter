/**
 * Unit tests for the AudioPlayback routing abstraction (DMY-18).
 *
 * The no-op is the shipped default (real routing/VoIP-session is DMY-9). The
 * safe wrapper must forward calls to a real controller and never throw, so a
 * flaky routing backend can never crash a monitoring session.
 */
import { createSafeAudioPlayback, noopAudioPlayback } from '../audioPlayback';
import type { AudioPlayback } from '../audioPlayback';
import type { MediaStreamLike } from '../mediaTypes';

const fakeStream: MediaStreamLike = { getTracks: () => [] };

describe('noopAudioPlayback', () => {
  it('never throws', () => {
    expect(() => {
      noopAudioPlayback.start(fakeStream);
      noopAudioPlayback.setMuted(true);
      noopAudioPlayback.stop();
    }).not.toThrow();
  });
});

describe('createSafeAudioPlayback', () => {
  it('forwards start/stop/setMuted to the wrapped controller', () => {
    const inner: AudioPlayback = {
      start: jest.fn(),
      stop: jest.fn(),
      setMuted: jest.fn(),
    };
    const safe = createSafeAudioPlayback(inner);

    safe.start(fakeStream);
    safe.setMuted(true);
    safe.stop();

    expect(inner.start).toHaveBeenCalledWith(fakeStream);
    expect(inner.setMuted).toHaveBeenCalledWith(true);
    expect(inner.stop).toHaveBeenCalledTimes(1);
  });

  it('swallows errors from a throwing controller', () => {
    const inner: AudioPlayback = {
      start: jest.fn(() => {
        throw new Error('routing failed');
      }),
      stop: jest.fn(() => {
        throw new Error('release failed');
      }),
      setMuted: jest.fn(() => {
        throw new Error('mute failed');
      }),
    };
    const safe = createSafeAudioPlayback(inner);
    expect(() => safe.start(fakeStream)).not.toThrow();
    expect(() => safe.setMuted(true)).not.toThrow();
    expect(() => safe.stop()).not.toThrow();
  });

  it('defaults to the no-op controller when none is provided', () => {
    const safe = createSafeAudioPlayback();
    expect(() => safe.start(fakeStream)).not.toThrow();
  });
});
