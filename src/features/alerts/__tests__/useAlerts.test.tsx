/**
 * Unit tests for useAlerts (DMY-26).
 *
 * Uses a controllable stub {@link AlertEventSource} (the test emits reduced
 * alert types) and a spy {@link AlertSoundPlayer}. Reads the real store (MMKV
 * mocked in-memory) to drive `alertSoundsEnabled`. No real audio/detection is
 * involved — those plug into the same injected contracts (DMY-8/21/25 sources,
 * DMY-9 player).
 */
import { act, renderHook } from '@testing-library/react-native';

import { useAlerts } from '../useAlerts';
import { soundIdForType } from '../alertSoundMap';
import type { AlertEventSource } from '../useAlerts';
import type { AlertSoundPlayer, AlertType } from '../alertTypes';
import { useAppStore } from '../../../store/useAppStore';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

function makeStubSource() {
  let listener: ((type: AlertType) => void) | null = null;
  const unsubscribe = jest.fn(() => {
    listener = null;
  });
  const source: AlertEventSource = onAlertType => {
    listener = onAlertType;
    return unsubscribe;
  };
  const emit = (type: AlertType) => {
    listener?.(type);
  };
  return { source, emit, unsubscribe };
}

function makeSpyPlayer(): AlertSoundPlayer & {
  playSound: jest.Mock;
  stop: jest.Mock;
} {
  return { playSound: jest.fn(), stop: jest.fn() };
}

describe('useAlerts', () => {
  beforeEach(() => {
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
    // Ensure alerts are enabled by default for most tests.
    if (!useAppStore.getState().settings.alertSoundsEnabled) {
      act(() => useAppStore.getState().toggleAlertSounds());
    }
  });

  it('raises an alert and plays the per-type sound on a detection event', () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();
    const onAlert = jest.fn();

    const { result } = renderHook(() =>
      useAlerts({ source, player, onAlert }),
    );

    act(() => emit('cry'));

    expect(player.playSound).toHaveBeenCalledWith(
      soundIdForType('cry'),
      expect.anything(),
    );
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(result.current.lastAlert?.type).toBe('cry');
    expect(result.current.lastAlert?.soundId).toBe(soundIdForType('cry'));
  });

  it('plays DIFFERENT sounds for cry, motion and noise (core AC)', () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();

    renderHook(() => useAlerts({ source, player }));

    // Emit in ascending priority so each preempts the previous (the hook uses
    // the real wall clock, so all three share one tick — priority decides).
    act(() => {
      emit('noise');
      emit('motion');
      emit('cry');
    });

    const ids = player.playSound.mock.calls.map(c => c[0]);
    expect(ids).toEqual([
      soundIdForType('noise'),
      soundIdForType('motion'),
      soundIdForType('cry'),
    ]);
    expect(new Set(ids).size).toBe(3);
  });

  it('does not play when alertSoundsEnabled is false', () => {
    act(() => useAppStore.getState().toggleAlertSounds()); // -> false
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();

    const { result } = renderHook(() => useAlerts({ source, player }));

    act(() => emit('cry'));

    expect(player.playSound).not.toHaveBeenCalled();
    expect(result.current.lastAlert).toBeNull();
  });

  it('throttles a repeat of the same type within its cooldown', () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();

    renderHook(() => useAlerts({ source, player }));

    act(() => {
      emit('noise');
      emit('noise');
      emit('noise');
    });

    expect(player.playSound).toHaveBeenCalledTimes(1);
  });

  it('higher-priority cry preempts a sounding noise', () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();

    renderHook(() => useAlerts({ source, player }));

    act(() => {
      emit('noise');
      emit('cry');
    });

    expect(player.stop).toHaveBeenCalled();
    expect(player.playSound).toHaveBeenLastCalledWith(
      soundIdForType('cry'),
      expect.anything(),
    );
  });

  it('defaults to the no-op player without throwing', () => {
    const { source, emit } = makeStubSource();
    const { result } = renderHook(() => useAlerts({ source }));
    act(() => emit('motion'));
    expect(result.current.lastAlert?.type).toBe('motion');
  });

  it('does not subscribe when disabled via the enabled flag', () => {
    const { source, emit, unsubscribe } = makeStubSource();
    const player = makeSpyPlayer();

    renderHook(() => useAlerts({ source, player, enabled: false }));

    act(() => emit('cry'));
    expect(player.playSound).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('stays idle with no source', () => {
    const { result } = renderHook(() => useAlerts());
    expect(result.current.lastAlert).toBeNull();
  });

  it('unsubscribes and stops the player on unmount', () => {
    const { source, unsubscribe } = makeStubSource();
    const player = makeSpyPlayer();

    const { unmount } = renderHook(() => useAlerts({ source, player }));
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(player.stop).toHaveBeenCalled();
  });

  it('does not re-subscribe when only onAlert changes', () => {
    const { source, emit, unsubscribe } = makeStubSource();
    const player = makeSpyPlayer();
    const first = jest.fn();
    const second = jest.fn();

    const { rerender } = renderHook(
      ({ cb }: { cb: jest.Mock }) =>
        useAlerts({ source, player, onAlert: cb }),
      { initialProps: { cb: first } },
    );

    rerender({ cb: second });
    expect(unsubscribe).not.toHaveBeenCalled();

    act(() => emit('cry'));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('honours a live toggle of alertSoundsEnabled without re-subscribe', () => {
    const { source, emit, unsubscribe } = makeStubSource();
    const player = makeSpyPlayer();

    renderHook(() => useAlerts({ source, player }));

    // Turn alerts OFF live.
    act(() => useAppStore.getState().toggleAlertSounds());
    act(() => emit('cry'));
    expect(player.playSound).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();

    // Turn back ON live.
    act(() => useAppStore.getState().toggleAlertSounds());
    act(() => emit('cry'));
    expect(player.playSound).toHaveBeenCalledTimes(1);
  });

  it('never exposes media in the raised alert (privacy)', () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();
    const onAlert = jest.fn();

    renderHook(() => useAlerts({ source, player, onAlert }));
    act(() => emit('cry'));

    const serialized = JSON.stringify(onAlert.mock.calls[0][0]);
    expect(serialized).not.toMatch(
      /audio|buffer|pcm|frame|pixel|metric|level|wav|mp3/i,
    );
  });
});
