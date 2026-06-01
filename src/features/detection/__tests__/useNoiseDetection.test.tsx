/**
 * Unit tests for useNoiseDetection (DMY-8).
 *
 * Uses a controllable stub {@link NoiseLevelSource}: the test pushes synthetic
 * loudness levels and asserts the hook updates state, fires `onNoise`, and
 * unsubscribes on unmount. No real microphone/WebRTC is involved — that source
 * (DMY-18) plugs into the same injected contract.
 */
import { act, renderHook } from '@testing-library/react-native';

import { logger } from '../../../services/logger';
import { useNoiseDetection } from '../useNoiseDetection';
import type { NoiseLevel, NoiseLevelSource } from '../types';

/**
 * Build a stub source plus an imperative `emit` to push levels from the test,
 * and an `unsubscribe` spy to assert teardown.
 */
function makeStubSource() {
  let listener: ((level: NoiseLevel) => void) | null = null;
  const unsubscribe = jest.fn(() => {
    listener = null;
  });
  const source: NoiseLevelSource = onLevel => {
    listener = onLevel;
    return unsubscribe;
  };
  const emit = (level: NoiseLevel) => {
    listener?.(level);
  };
  return { source, emit, unsubscribe };
}

describe('useNoiseDetection', () => {
  it('fires onNoise and records lastEvent when the level crosses the threshold', () => {
    const { source, emit } = makeStubSource();
    const onNoise = jest.fn();

    const { result } = renderHook(() =>
      useNoiseDetection({ source, onNoise, config: { enterThreshold: 0.6 } }),
    );

    act(() => emit(0.9));

    expect(onNoise).toHaveBeenCalledTimes(1);
    expect(onNoise.mock.calls[0][0]).toMatchObject({
      type: 'noise',
      level: 0.9,
      threshold: 0.6,
    });
    expect(result.current.lastEvent?.level).toBe(0.9);
    expect(result.current.armed).toBe(true);
    expect(result.current.level).toBe(0.9);
  });

  it('does not fire below the threshold but still tracks the live level', () => {
    const { source, emit } = makeStubSource();
    const onNoise = jest.fn();

    const { result } = renderHook(() =>
      useNoiseDetection({ source, onNoise, config: { enterThreshold: 0.6 } }),
    );

    act(() => emit(0.2));

    expect(onNoise).not.toHaveBeenCalled();
    expect(result.current.lastEvent).toBeNull();
    expect(result.current.armed).toBe(false);
    expect(result.current.level).toBe(0.2);
  });

  it('does not spam onNoise while the level stays loud (hysteresis)', () => {
    const { source, emit } = makeStubSource();
    const onNoise = jest.fn();

    renderHook(() =>
      useNoiseDetection({
        source,
        onNoise,
        config: { enterThreshold: 0.6, exitThreshold: 0.4 },
      }),
    );

    act(() => {
      emit(0.9);
      emit(0.95);
      emit(0.7);
    });

    expect(onNoise).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe when disabled', () => {
    const { source, emit, unsubscribe } = makeStubSource();
    const onNoise = jest.fn();

    renderHook(() =>
      useNoiseDetection({
        source,
        onNoise,
        enabled: false,
        config: { enterThreshold: 0.6 },
      }),
    );

    act(() => emit(0.9));
    expect(onNoise).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('unsubscribes from the source on unmount', () => {
    const { source, unsubscribe } = makeStubSource();

    const { unmount } = renderHook(() =>
      useNoiseDetection({ source, config: { enterThreshold: 0.6 } }),
    );

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('stays idle with no source (real source arrives in DMY-18)', () => {
    const { result } = renderHook(() =>
      useNoiseDetection({ config: { enterThreshold: 0.6 } }),
    );
    expect(result.current.level).toBeNull();
    expect(result.current.armed).toBe(false);
    expect(result.current.lastEvent).toBeNull();
  });

  it('ignores NaN samples (no crash, no false event)', () => {
    const { source, emit } = makeStubSource();
    const onNoise = jest.fn();

    const { result } = renderHook(() =>
      useNoiseDetection({ source, onNoise, config: { enterThreshold: 0.6 } }),
    );

    act(() => emit(NaN));
    expect(onNoise).not.toHaveBeenCalled();
    expect(result.current.armed).toBe(false);
  });

  it('logs only the privacy-safe metric, never audio', () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    try {
      const { source, emit } = makeStubSource();
      renderHook(() =>
        useNoiseDetection({ source, config: { enterThreshold: 0.6 } }),
      );

      act(() => emit(0.9));

      expect(infoSpy).toHaveBeenCalled();
      for (const call of infoSpy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toMatch(/audio|buffer|pcm|samples|wav/i);
      }
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('keeps the same session when only onNoise changes (no re-subscribe)', () => {
    const { source, emit, unsubscribe } = makeStubSource();
    const first = jest.fn();
    const second = jest.fn();

    const { rerender } = renderHook(
      ({ cb }: { cb: jest.Mock }) =>
        useNoiseDetection({
          source,
          onNoise: cb,
          config: { enterThreshold: 0.6 },
        }),
      { initialProps: { cb: first } },
    );

    rerender({ cb: second });
    // Source must not have been torn down just because the callback changed.
    expect(unsubscribe).not.toHaveBeenCalled();

    act(() => emit(0.9));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
