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
import type { AlertNotificationPresenter } from '../notificationPresenter';
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

function makeSpyPresenter(): AlertNotificationPresenter & {
  present: jest.Mock;
} {
  return { present: jest.fn() };
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

  // --- DMY-46: local notification sink (in parallel to the sound) ----------

  it('presents a notification AND plays the sound for a raised event', () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();
    const presenter = makeSpyPresenter();

    renderHook(() => useAlerts({ source, player, presenter }));
    act(() => emit('cry'));

    // Both sinks fire in parallel for the one raised event.
    expect(player.playSound).toHaveBeenCalledTimes(1);
    expect(presenter.present).toHaveBeenCalledTimes(1);
    expect(presenter.present.mock.calls[0][0]).toMatchObject({ type: 'cry' });
  });

  it('presents exactly once per raised event', () => {
    const { source, emit } = makeStubSource();
    const presenter = makeSpyPresenter();

    renderHook(() => useAlerts({ source, presenter }));
    // Ascending priority so each preempts the previous within the shared tick
    // (mirrors the "different sounds" sound-sink test): both are RAISED.
    act(() => {
      emit('motion');
      emit('cry');
    });

    expect(presenter.present).toHaveBeenCalledTimes(2);
    expect(presenter.present.mock.calls.map(c => c[0].type)).toEqual([
      'motion',
      'cry',
    ]);
  });

  it('does NOT present when the event is throttled (cooldown drop)', () => {
    const { source, emit } = makeStubSource();
    const presenter = makeSpyPresenter();

    renderHook(() => useAlerts({ source, presenter }));
    act(() => {
      emit('noise');
      emit('noise'); // dropped: same type within cooldown
      emit('noise');
    });

    // Only the first (raised) noise notifies; the throttled repeats do not.
    expect(presenter.present).toHaveBeenCalledTimes(1);
  });

  it('does NOT present a lower-priority event dropped by priority', () => {
    const { source, emit } = makeStubSource();
    const presenter = makeSpyPresenter();

    renderHook(() => useAlerts({ source, presenter }));
    act(() => {
      emit('cry'); // raised (highest priority, occupies channel)
      emit('noise'); // dropped by priority while cry is sounding
    });

    expect(presenter.present).toHaveBeenCalledTimes(1);
    expect(presenter.present.mock.calls[0][0]).toMatchObject({ type: 'cry' });
  });

  it('does NOT present when alerts are disabled (whole event dropped)', () => {
    act(() => useAppStore.getState().toggleAlertSounds()); // -> false
    const { source, emit } = makeStubSource();
    const presenter = makeSpyPresenter();

    renderHook(() => useAlerts({ source, presenter }));
    act(() => emit('cry'));

    expect(presenter.present).not.toHaveBeenCalled();
  });

  it('a presenter throw does not stop the sound or the pipeline', () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();
    const presenter: AlertNotificationPresenter = {
      present: jest.fn(() => {
        throw new Error('notifee blew up');
      }),
    };
    const onAlert = jest.fn();

    const { result } = renderHook(() =>
      useAlerts({ source, player, presenter, onAlert }),
    );

    expect(() => act(() => emit('cry'))).not.toThrow();
    // Sound still played, state + callback still updated despite the throw.
    expect(player.playSound).toHaveBeenCalledTimes(1);
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(result.current.lastAlert?.type).toBe('cry');
  });

  it('a presenter async rejection does not break the pipeline', async () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();
    const presenter: AlertNotificationPresenter = {
      present: jest.fn(() => Promise.reject(new Error('async fail'))),
    };

    const { result } = renderHook(() =>
      useAlerts({ source, player, presenter }),
    );

    await act(async () => {
      emit('cry');
      // Let the rejected promise settle so an unhandled rejection would surface.
      await Promise.resolve();
    });

    expect(player.playSound).toHaveBeenCalledTimes(1);
    expect(result.current.lastAlert?.type).toBe('cry');
  });

  it('defaults to the no-op presenter without throwing', () => {
    const { source, emit } = makeStubSource();
    const { result } = renderHook(() => useAlerts({ source }));
    act(() => emit('motion'));
    expect(result.current.lastAlert?.type).toBe('motion');
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
