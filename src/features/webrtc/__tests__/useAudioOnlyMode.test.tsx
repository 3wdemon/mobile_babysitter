/**
 * Unit tests for useAudioOnlyMode (DMY-24).
 *
 * Uses a spy {@link VideoTrackController} (no WebRTC) and the real store (MMKV
 * mocked in-memory). Asserts the core AC: with audio-only ON the video track is
 * NOT requested on entry, a peek temporarily enables it and returns to
 * audio-only, with audio-only OFF video is requested, and the no-op controller
 * never throws.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useAudioOnlyMode } from '../useAudioOnlyMode';
import { useAppStore } from '../../../store/useAppStore';
import type { VideoTrackController } from '../types';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

function makeSpyController(): {
  controller: VideoTrackController;
  enableVideo: jest.Mock;
  disableVideo: jest.Mock;
} {
  const enableVideo = jest.fn<void, []>();
  const disableVideo = jest.fn<void, []>();
  return {
    controller: { enableVideo, disableVideo },
    enableVideo,
    disableVideo,
  };
}

describe('useAudioOnlyMode', () => {
  beforeEach(() => {
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
  });

  it('does NOT request video on entry while audio-only is enabled', () => {
    // Default settings.audioOnlyEnabled === true.
    const spy = makeSpyController();

    const { result } = renderHook(() =>
      useAudioOnlyMode({ controller: spy.controller }),
    );

    expect(spy.enableVideo).not.toHaveBeenCalled();
    // It actively keeps the track disabled.
    expect(spy.disableVideo).toHaveBeenCalled();
    expect(result.current.mode).toBe('audio-only');
    expect(result.current.audioOnlyEnabled).toBe(true);
    expect(result.current.isPeeking).toBe(false);
  });

  it('enables video temporarily on showVideo (peek) and disables on hideVideo', () => {
    const spy = makeSpyController();

    const { result } = renderHook(() =>
      useAudioOnlyMode({ controller: spy.controller }),
    );
    spy.enableVideo.mockClear();
    spy.disableVideo.mockClear();

    act(() => result.current.showVideo());

    expect(spy.enableVideo).toHaveBeenCalledTimes(1);
    expect(result.current.mode).toBe('video');
    expect(result.current.isPeeking).toBe(true);

    act(() => result.current.hideVideo());

    expect(spy.disableVideo).toHaveBeenCalled();
    expect(result.current.mode).toBe('audio-only');
    expect(result.current.isPeeking).toBe(false);
  });

  it('requests video when audio-only is disabled (full video mode)', () => {
    act(() => useAppStore.getState().setAudioOnlyEnabled(false));
    const spy = makeSpyController();

    const { result } = renderHook(() =>
      useAudioOnlyMode({ controller: spy.controller }),
    );

    expect(spy.enableVideo).toHaveBeenCalled();
    expect(result.current.mode).toBe('video');
    expect(result.current.audioOnlyEnabled).toBe(false);
    expect(result.current.isPeeking).toBe(false);
  });

  it('switches to audio-only (disabling video) when the user enables audio-only mid-session', () => {
    act(() => useAppStore.getState().setAudioOnlyEnabled(false));
    const spy = makeSpyController();

    const { result } = renderHook(() =>
      useAudioOnlyMode({ controller: spy.controller }),
    );
    spy.disableVideo.mockClear();

    act(() => useAppStore.getState().setAudioOnlyEnabled(true));

    expect(spy.disableVideo).toHaveBeenCalled();
    expect(result.current.mode).toBe('audio-only');
  });

  it('clears a stale peek when audio-only is turned off mid-peek', () => {
    const spy = makeSpyController();

    const { result } = renderHook(() =>
      useAudioOnlyMode({ controller: spy.controller }),
    );

    act(() => result.current.showVideo());
    expect(result.current.isPeeking).toBe(true);

    act(() => useAppStore.getState().setAudioOnlyEnabled(false));

    // Now full video mode; the peek flag is moot and reported false.
    expect(result.current.isPeeking).toBe(false);
    expect(result.current.mode).toBe('video');
  });

  it('disables video on unmount (no leaked track)', () => {
    act(() => useAppStore.getState().setAudioOnlyEnabled(false));
    const spy = makeSpyController();

    const { unmount } = renderHook(() =>
      useAudioOnlyMode({ controller: spy.controller }),
    );
    spy.disableVideo.mockClear();

    unmount();

    expect(spy.disableVideo).toHaveBeenCalledTimes(1);
  });

  it('disables the previous controller when the controller identity changes', () => {
    act(() => useAppStore.getState().setAudioOnlyEnabled(false));
    const first = makeSpyController();
    const second = makeSpyController();

    const { rerender } = renderHook(
      ({ controller }: { controller: VideoTrackController }) =>
        useAudioOnlyMode({ controller }),
      { initialProps: { controller: first.controller } },
    );
    first.disableVideo.mockClear();

    rerender({ controller: second.controller });

    // Previous controller is torn down (no leaked video track) and the new one
    // takes over the desired track state (full video mode here).
    expect(first.disableVideo).toHaveBeenCalled();
    expect(second.enableVideo).toHaveBeenCalled();
  });

  it('does not throw with the default no-op controller (no WebRTC)', () => {
    expect(() => {
      const { result } = renderHook(() => useAudioOnlyMode());
      act(() => result.current.showVideo());
      act(() => result.current.hideVideo());
    }).not.toThrow();
  });
});
