/**
 * Unit tests for useCryDetection (DMY-49).
 *
 * Uses a controllable stub {@link CrySampleSource} plus a REAL
 * {@link AlertService} with a spy {@link AlertSoundPlayer}, so we assert the hook
 * raises the `'cry'` AlertType THROUGH the service (distinct cry sound played)
 * and that it RESPECTS the service policy — a cry dropped by the service raises
 * no alert and is not surfaced as `lastAlert`. Also covers cleanup on unmount.
 *
 * No real audio is involved — the source plugs into the same injected contract a
 * real DSP tap (DMY-18/DMY-9) will.
 */
import { act, renderHook } from '@testing-library/react-native';

import { createAlertService } from '../../alerts/alertService';
import { soundIdForType } from '../../alerts/alertSoundMap';
import type { AlertSoundPlayer } from '../../alerts/alertTypes';
import { DEFAULT_CRY_CONFIG } from '../cryConfig';
import { useCryDetection } from '../useCryDetection';
import { noopCrySampleSource } from '../cryTypes';
import type { CrySample, CrySampleSource } from '../cryTypes';

function makeStubSource() {
  let listener: ((sample: CrySample) => void) | null = null;
  const unsubscribe = jest.fn(() => {
    listener = null;
  });
  const source: CrySampleSource = onSample => {
    listener = onSample;
    return unsubscribe;
  };
  const emit = (sample: CrySample) => {
    listener?.(sample);
  };
  return { source, emit, unsubscribe };
}

function makeSpyPlayer(): AlertSoundPlayer & {
  playSound: jest.Mock;
  stop: jest.Mock;
} {
  return { playSound: jest.fn(), stop: jest.fn() };
}

const CONFIG = DEFAULT_CRY_CONFIG;

/** A ~7s sustained, in-band cry: enough samples to cross the 5s rule. */
function sustainedCry(startMs = 0): CrySample[] {
  const out: CrySample[] = [];
  for (let i = 0; i < 70; i += 1) {
    out.push({ rms: 0.75, bandEnergyRatio: 0.7, timestamp: startMs + i * 100 });
  }
  return out;
}

describe('useCryDetection', () => {
  it('raises the cry AlertType through the AlertService with its distinct sound', () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();
    const alertService = createAlertService({ player, now: () => 1_000 });
    const onCry = jest.fn();
    const onAlert = jest.fn();

    const { result } = renderHook(() =>
      useCryDetection({ source, config: CONFIG, alertService, onCry, onAlert }),
    );

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });

    expect(onCry).toHaveBeenCalledTimes(1);
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert.mock.calls[0][0]).toMatchObject({ type: 'cry' });
    // Went through the service: the DISTINCT cry sound was played.
    expect(player.playSound).toHaveBeenCalledWith(
      soundIdForType('cry'),
      expect.any(Number),
    );
    expect(result.current.lastEvent?.type).toBe('cry');
    expect(result.current.lastAlert?.type).toBe('cry');
  });

  it('does not fire for a short (<5s) burst', () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();
    const alertService = createAlertService({ player });
    const onCry = jest.fn();

    renderHook(() =>
      useCryDetection({ source, config: CONFIG, alertService, onCry }),
    );

    act(() => {
      // 2s loud in-band burst, then silence.
      for (let i = 0; i < 20; i += 1) {
        emit({ rms: 0.85, bandEnergyRatio: 0.7, timestamp: i * 100 });
      }
      for (let i = 0; i < 20; i += 1) {
        emit({ rms: 0.05, bandEnergyRatio: 0.2, timestamp: 2000 + i * 100 });
      }
    });

    expect(onCry).not.toHaveBeenCalled();
    expect(player.playSound).not.toHaveBeenCalled();
  });

  it('does not fire for loud out-of-band noise (white noise)', () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();
    const alertService = createAlertService({ player });
    const onCry = jest.fn();

    renderHook(() =>
      useCryDetection({ source, config: CONFIG, alertService, onCry }),
    );

    act(() => {
      for (let i = 0; i < 120; i += 1) {
        emit({ rms: 0.9, bandEnergyRatio: 0.3, timestamp: i * 100 });
      }
    });

    expect(onCry).not.toHaveBeenCalled();
    expect(player.playSound).not.toHaveBeenCalled();
  });

  it('RESPECTS service policy: a cry dropped by enablement raises no alert', () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();
    // Service disabled -> handle('cry') returns a dropped result.
    const alertService = createAlertService({
      player,
      isEnabled: () => false,
    });
    const onCry = jest.fn();
    const onAlert = jest.fn();

    const { result } = renderHook(() =>
      useCryDetection({ source, config: CONFIG, alertService, onCry, onAlert }),
    );

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });

    // The detector still detected the cry (onCry fired)...
    expect(onCry).toHaveBeenCalledTimes(1);
    // ...but the service dropped it: NO sound, NO alert surfaced. Not bypassed.
    expect(player.playSound).not.toHaveBeenCalled();
    expect(onAlert).not.toHaveBeenCalled();
    expect(result.current.lastAlert).toBeNull();
  });

  it('RESPECTS service policy: a cry within snooze STILL sounds (breaksThroughSnooze)', () => {
    const { source, emit } = makeStubSource();
    const player = makeSpyPlayer();
    const alertService = createAlertService({ player, now: () => 0 });
    // Snooze: cry is flagged breaksThroughSnooze, so it must still raise.
    alertService.snooze(60_000);
    const onAlert = jest.fn();

    renderHook(() =>
      useCryDetection({ source, config: CONFIG, alertService, onAlert }),
    );

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });

    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(player.playSound).toHaveBeenCalledWith(
      soundIdForType('cry'),
      expect.any(Number),
    );
  });

  it('runs the detector but raises no alert when no service is injected', () => {
    const { source, emit } = makeStubSource();
    const onCry = jest.fn();
    const onAlert = jest.fn();

    const { result } = renderHook(() =>
      useCryDetection({ source, config: CONFIG, onCry, onAlert }),
    );

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });

    expect(onCry).toHaveBeenCalledTimes(1);
    expect(onAlert).not.toHaveBeenCalled();
    expect(result.current.lastEvent?.type).toBe('cry');
    expect(result.current.lastAlert).toBeNull();
  });

  it('does not subscribe when disabled', () => {
    const { source, emit, unsubscribe } = makeStubSource();
    const onCry = jest.fn();

    renderHook(() =>
      useCryDetection({ source, config: CONFIG, enabled: false, onCry }),
    );

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });

    expect(onCry).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { source, unsubscribe } = makeStubSource();
    const { unmount } = renderHook(() =>
      useCryDetection({ source, config: CONFIG }),
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('the shipped noop source subscribes nothing and emits no samples', () => {
    const onCry = jest.fn();
    const { result } = renderHook(() =>
      useCryDetection({ source: noopCrySampleSource, config: CONFIG, onCry }),
    );
    // The noop source never pushes, so nothing is ever detected; unsubscribe is
    // a safe no-op on unmount.
    expect(onCry).not.toHaveBeenCalled();
    expect(result.current.lastEvent).toBeNull();
  });

  it('stays idle with no source (real DSP source arrives in DMY-18/DMY-9)', () => {
    const { result } = renderHook(() => useCryDetection({ config: CONFIG }));
    expect(result.current.lastSample).toBeNull();
    expect(result.current.candidate).toBe(false);
    expect(result.current.lastEvent).toBeNull();
    expect(result.current.lastAlert).toBeNull();
  });

  it('keeps the same session when only callbacks change (no re-subscribe)', () => {
    const { source, emit, unsubscribe } = makeStubSource();
    const first = jest.fn();
    const second = jest.fn();

    const { rerender } = renderHook(
      ({ cb }: { cb: jest.Mock }) =>
        useCryDetection({ source, config: CONFIG, onCry: cb }),
      { initialProps: { cb: first } },
    );

    rerender({ cb: second });
    expect(unsubscribe).not.toHaveBeenCalled();

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
