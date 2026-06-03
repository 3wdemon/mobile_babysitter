/**
 * Integration test: cry detection -> alerts pipeline (DMY-49 regression guard).
 *
 * Proves that a cry detected by {@link useCryDetection}, when adapted into the
 * SAME {@link AlertEventSource} that {@link useAlerts} consumes (exactly as the
 * parent screen adapts `onNoise`/`onMotion`), drives BOTH sinks:
 *
 *  - the per-type `alert-cry` sound (DMY-26), and
 *  - the local-notification presenter (DMY-46), which `useAlerts.handleType`
 *    fires IN PARALLEL with the sound for every RAISED event.
 *
 * This closes the regression where cry went DIRECTLY to `alertService.handle`
 * and therefore played a sound but NEVER produced a notification. The cry path
 * is now indistinguishable from noise/motion at the alert boundary.
 *
 * No real audio/notifications: the cry source, sound player and presenter are
 * all spies plugging into the same injected contracts production will use.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useAlerts } from '../../alerts/useAlerts';
import type { AlertEventSource } from '../../alerts/useAlerts';
import { soundIdForType } from '../../alerts/alertSoundMap';
import type { AlertNotificationPresenter } from '../../alerts/notificationPresenter';
import type { AlertSoundPlayer, AlertType } from '../../alerts/alertTypes';
import { useAppStore } from '../../../store/useAppStore';
import { DEFAULT_CRY_CONFIG } from '../cryConfig';
import { useCryDetection } from '../useCryDetection';
import type { CryEvent, CrySample, CrySampleSource } from '../cryTypes';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

function makeStubCrySource() {
  let listener: ((sample: CrySample) => void) | null = null;
  const unsubscribe = jest.fn(() => {
    listener = null;
  });
  const source: CrySampleSource = onSample => {
    listener = onSample;
    return unsubscribe;
  };
  const emit = (sample: CrySample) => listener?.(sample);
  return { source, emit, unsubscribe };
}

function makeSpyPlayer(): AlertSoundPlayer & {
  playSound: jest.Mock;
  stop: jest.Mock;
} {
  return { playSound: jest.fn(), stop: jest.fn() };
}

function makeSpyPresenter(): AlertNotificationPresenter & { present: jest.Mock } {
  return { present: jest.fn() };
}

/** ~7s sustained, in-band cry: enough samples to cross the 5s rule. */
function sustainedCry(startMs = 0): CrySample[] {
  const out: CrySample[] = [];
  for (let i = 0; i < 70; i += 1) {
    out.push({ rms: 0.75, bandEnergyRatio: 0.7, timestamp: startMs + i * 100 });
  }
  return out;
}

describe('cry detection -> alerts integration', () => {
  beforeEach(() => {
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
    if (!useAppStore.getState().settings.alertSoundsEnabled) {
      act(() => useAppStore.getState().toggleAlertSounds());
    }
  });

  it('routes a detected cry through useAlerts: plays the sound AND presents a notification', () => {
    const { source: crySource, emit } = makeStubCrySource();
    const player = makeSpyPlayer();
    const presenter = makeSpyPresenter();

    // The adapter the parent screen uses: turn the cry detector's `onCry` into
    // the AlertEventSource useAlerts consumes (identical shape to noise/motion).
    let onCry: ((event: CryEvent) => void) | undefined;
    const cryAlertSource: AlertEventSource = onAlertType => {
      onCry = () => onAlertType('cry');
      return () => {
        onCry = undefined;
      };
    };

    renderHook(() => {
      useAlerts({ source: cryAlertSource, player, presenter });
      useCryDetection({
        source: crySource,
        config: DEFAULT_CRY_CONFIG,
        onCry: event => onCry?.(event),
      });
    });

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });

    // BOTH sinks fired for the one raised cry — the notification is back.
    expect(player.playSound).toHaveBeenCalledTimes(1);
    expect(player.playSound).toHaveBeenCalledWith(
      soundIdForType('cry'),
      expect.anything(),
    );
    expect(presenter.present).toHaveBeenCalledTimes(1);
    expect(presenter.present.mock.calls[0][0]).toMatchObject({ type: 'cry' });
  });

  it('respects policy: a cry adapted into useAlerts while alerts are disabled neither sounds nor notifies', () => {
    act(() => useAppStore.getState().toggleAlertSounds()); // -> false
    const { source: crySource, emit } = makeStubCrySource();
    const player = makeSpyPlayer();
    const presenter = makeSpyPresenter();

    let onCry: ((event: CryEvent) => void) | undefined;
    const cryAlertSource: AlertEventSource = onAlertType => {
      onCry = () => onAlertType('cry');
      return () => {
        onCry = undefined;
      };
    };

    renderHook(() => {
      useAlerts({ source: cryAlertSource, player, presenter });
      useCryDetection({
        source: crySource,
        config: DEFAULT_CRY_CONFIG,
        onCry: event => onCry?.(event),
      });
    });

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });

    // Same policy as noise/motion: the whole event is dropped at the service.
    expect(player.playSound).not.toHaveBeenCalled();
    expect(presenter.present).not.toHaveBeenCalled();
  });

  it('treats cry exactly like noise/motion at the alert boundary (cry preempts a sounding noise, both notify)', () => {
    // Two independent sources feeding the SAME useAlerts via one AlertEventSource
    // proves the cry path is not special-cased — priority/preemption applies.
    let listener: ((type: AlertType) => void) | null = null;
    const source: AlertEventSource = onAlertType => {
      listener = onAlertType;
      return () => {
        listener = null;
      };
    };
    const player = makeSpyPlayer();
    const presenter = makeSpyPresenter();

    renderHook(() => useAlerts({ source, player, presenter }));

    act(() => {
      listener?.('noise'); // raised, occupies the channel
      listener?.('cry'); // higher priority -> preempts noise
    });

    // noise preempted by cry; both raised events notified.
    expect(player.stop).toHaveBeenCalled();
    expect(player.playSound).toHaveBeenLastCalledWith(
      soundIdForType('cry'),
      expect.anything(),
    );
    expect(presenter.present).toHaveBeenCalledTimes(2);
    expect(presenter.present.mock.calls.map(c => c[0].type)).toEqual([
      'noise',
      'cry',
    ]);
  });
});
