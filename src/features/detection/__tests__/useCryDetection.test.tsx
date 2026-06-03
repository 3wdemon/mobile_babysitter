/**
 * Unit tests for useCryDetection (DMY-49).
 *
 * Uses a controllable stub {@link CrySampleSource}. The hook is a PURE detector
 * (mirroring useNoiseDetection/useMotionDetection): it subscribes the source,
 * feeds the heuristic core, and fires `onCry` ONCE per detected episode — it
 * never touches the AlertService. The alert layer (sound + notification +
 * policy) is exercised where cry is routed through `useAlerts` (see the
 * detection→alerts integration test). Also covers cleanup on unmount.
 *
 * No real audio is involved — the source plugs into the same injected contract a
 * real DSP tap (DMY-18/DMY-9) will.
 */
import { act, renderHook } from '@testing-library/react-native';

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
  it('fires onCry once per episode (not per sample) and surfaces lastEvent', () => {
    const { source, emit } = makeStubSource();
    const onCry = jest.fn();

    const { result } = renderHook(() =>
      useCryDetection({ source, config: CONFIG, onCry }),
    );

    act(() => {
      for (const s of sustainedCry()) {
        emit(s);
      }
    });

    // One episode -> exactly one onCry, despite ~70 samples flowing through.
    expect(onCry).toHaveBeenCalledTimes(1);
    expect(onCry.mock.calls[0][0]).toMatchObject({ type: 'cry' });
    expect(result.current.lastEvent?.type).toBe('cry');
  });

  it('does not fire for a short (<5s) burst', () => {
    const { source, emit } = makeStubSource();
    const onCry = jest.fn();

    renderHook(() => useCryDetection({ source, config: CONFIG, onCry }));

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
  });

  it('does not fire for loud out-of-band noise (white noise)', () => {
    const { source, emit } = makeStubSource();
    const onCry = jest.fn();

    renderHook(() => useCryDetection({ source, config: CONFIG, onCry }));

    act(() => {
      for (let i = 0; i < 120; i += 1) {
        emit({ rms: 0.9, bandEnergyRatio: 0.3, timestamp: i * 100 });
      }
    });

    expect(onCry).not.toHaveBeenCalled();
  });

  it('tracks the candidate (cry-shaped) state while an episode builds', () => {
    const { source, emit } = makeStubSource();

    const { result } = renderHook(() =>
      useCryDetection({ source, config: CONFIG }),
    );

    act(() => {
      // A single loud in-band sample makes a candidate without crossing 5s.
      emit({ rms: 0.8, bandEnergyRatio: 0.7, timestamp: 0 });
    });
    expect(result.current.candidate).toBe(true);
    expect(result.current.lastEvent).toBeNull();
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
  });

  it('keeps the same session when only the callback changes (no re-subscribe)', () => {
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
