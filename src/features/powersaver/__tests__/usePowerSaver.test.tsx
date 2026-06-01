/**
 * Unit tests for usePowerSaver (DMY-12).
 *
 * Uses a spy {@link PowerSaverBackend} (no native module) and the real store
 * (MMKV mocked in-memory). Asserts: power-saver applies while a session is
 * active+enabled, restores on session end / disable / unmount (exactly once),
 * stays off when the setting is disabled, and is idempotent across re-renders.
 */
import { act, renderHook } from '@testing-library/react-native';

import { DIM_BRIGHTNESS } from '../config';
import { usePowerSaver } from '../usePowerSaver';
import { useAppStore } from '../../../store/useAppStore';
import type { Brightness, PowerSaverBackend } from '../types';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

function makeSpyBackend(initial: Brightness | null = 0.7): {
  backend: PowerSaverBackend;
  setBrightness: jest.Mock;
  setKeepAwake: jest.Mock;
  setSensorsEnabled: jest.Mock;
} {
  const setBrightness = jest.fn<void, [number]>();
  const setKeepAwake = jest.fn<void, [boolean]>();
  const setSensorsEnabled = jest.fn<void, [boolean]>();
  const backend: PowerSaverBackend = {
    getBrightness: () => initial,
    setBrightness,
    setKeepAwake,
    setSensorsEnabled,
  };
  return { backend, setBrightness, setKeepAwake, setSensorsEnabled };
}

describe('usePowerSaver', () => {
  beforeEach(() => {
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
  });

  it('applies power-saver when the session is active and enabled', () => {
    const spy = makeSpyBackend();

    const { result } = renderHook(() =>
      usePowerSaver({ active: true, backend: spy.backend }),
    );

    expect(spy.setBrightness).toHaveBeenCalledWith(DIM_BRIGHTNESS);
    expect(spy.setKeepAwake).toHaveBeenCalledWith(true);
    expect(spy.setSensorsEnabled).toHaveBeenCalledWith(false);
    expect(result.current.active).toBe(true);
    expect(result.current.enabled).toBe(true);
  });

  it('does not apply while the session is inactive', () => {
    const spy = makeSpyBackend();

    const { result } = renderHook(() =>
      usePowerSaver({ active: false, backend: spy.backend }),
    );

    expect(spy.setBrightness).not.toHaveBeenCalled();
    expect(spy.setKeepAwake).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });

  it('restores when the session goes inactive', () => {
    const spy = makeSpyBackend(0.7);

    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        usePowerSaver({ active, backend: spy.backend }),
      { initialProps: { active: true } },
    );
    spy.setBrightness.mockClear();

    rerender({ active: false });

    expect(spy.setBrightness).toHaveBeenCalledWith(0.7);
    expect(spy.setKeepAwake).toHaveBeenLastCalledWith(false);
    expect(spy.setSensorsEnabled).toHaveBeenLastCalledWith(true);
  });

  it('does not apply when power-saver is disabled in settings', () => {
    act(() => useAppStore.getState().setPowerSaverEnabled(false));
    const spy = makeSpyBackend();

    const { result } = renderHook(() =>
      usePowerSaver({ active: true, backend: spy.backend }),
    );

    expect(spy.setBrightness).not.toHaveBeenCalled();
    expect(spy.setKeepAwake).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
    expect(result.current.enabled).toBe(false);
  });

  it('restores when the user disables power-saver mid-session', () => {
    const spy = makeSpyBackend(0.7);

    const { rerender } = renderHook(
      (_props: Record<string, never>) =>
        usePowerSaver({ active: true, backend: spy.backend }),
      { initialProps: {} },
    );
    spy.setBrightness.mockClear();

    act(() => useAppStore.getState().setPowerSaverEnabled(false));
    rerender({});

    expect(spy.setBrightness).toHaveBeenCalledWith(0.7);
    expect(spy.setKeepAwake).toHaveBeenLastCalledWith(false);
  });

  it('restores on unmount (exactly once)', () => {
    const spy = makeSpyBackend(0.7);

    const { unmount } = renderHook(() =>
      usePowerSaver({ active: true, backend: spy.backend }),
    );
    spy.setKeepAwake.mockClear();

    unmount();

    expect(spy.setKeepAwake).toHaveBeenCalledTimes(1);
    expect(spy.setKeepAwake).toHaveBeenCalledWith(false);
  });

  it('is idempotent across re-renders while staying active (no double-apply)', () => {
    const spy = makeSpyBackend();

    const { rerender } = renderHook(
      (_props: Record<string, never>) =>
        usePowerSaver({ active: true, backend: spy.backend }),
      { initialProps: {} },
    );

    rerender({});
    rerender({});

    // Applied once on mount; re-renders with the same condition do not re-apply.
    expect(spy.setKeepAwake).toHaveBeenCalledTimes(1);
    expect(spy.setBrightness).toHaveBeenCalledTimes(1);
  });

  it('restores the previous backend and re-applies on the new one when the backend identity changes', () => {
    const first = makeSpyBackend(0.7);
    const second = makeSpyBackend(0.4);

    const { rerender } = renderHook(
      ({ backend }: { backend: PowerSaverBackend }) =>
        usePowerSaver({ active: true, backend }),
      { initialProps: { backend: first.backend } },
    );

    // Applied via the first backend.
    expect(first.setBrightness).toHaveBeenCalledWith(DIM_BRIGHTNESS);
    expect(first.setKeepAwake).toHaveBeenLastCalledWith(true);

    rerender({ backend: second.backend });

    // Previous backend is restored exactly once (no leaked dim / keep-awake).
    expect(first.setBrightness).toHaveBeenLastCalledWith(0.7);
    expect(first.setKeepAwake).toHaveBeenLastCalledWith(false);
    expect(first.setSensorsEnabled).toHaveBeenLastCalledWith(true);

    // The new backend takes over the posture.
    expect(second.setBrightness).toHaveBeenCalledWith(DIM_BRIGHTNESS);
    expect(second.setKeepAwake).toHaveBeenLastCalledWith(true);
  });

  it('does not restore the previous backend on an ordinary re-render (stable backend)', () => {
    const spy = makeSpyBackend(0.7);

    const { rerender } = renderHook(
      ({ backend }: { backend: PowerSaverBackend }) =>
        usePowerSaver({ active: true, backend }),
      { initialProps: { backend: spy.backend } },
    );
    spy.setKeepAwake.mockClear();

    // Same backend identity -> no rebuild, no restore, no re-apply.
    rerender({ backend: spy.backend });
    rerender({ backend: spy.backend });

    expect(spy.setKeepAwake).not.toHaveBeenCalled();
  });

  it('does not throw with the default no-op backend (no native module)', () => {
    expect(() =>
      renderHook(() => usePowerSaver({ active: true })),
    ).not.toThrow();
  });
});
