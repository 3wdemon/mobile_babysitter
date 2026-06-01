/**
 * Unit tests for PowerSaverService (DMY-12).
 *
 * Drives the orchestration core with a spy backend (no native module): asserts
 * dim+keep-awake+sensors-off on apply, restoration of the captured brightness on
 * exit, idempotency, the no-native fallback, and that nothing ever throws.
 */
import { DEFAULT_RESTORE_BRIGHTNESS, DIM_BRIGHTNESS } from '../config';
import {
  createPowerSaverService,
  noopBackend,
  PowerSaverService,
} from '../powerSaverService';
import type { Brightness, PowerSaverBackend } from '../types';

/** A spy backend with a controllable getBrightness and call recorders. */
function makeSpyBackend(initial: Brightness | null = 0.8): {
  backend: PowerSaverBackend;
  setBrightness: jest.Mock;
  setKeepAwake: jest.Mock;
  setSensorsEnabled: jest.Mock;
  getBrightness: jest.Mock;
} {
  const setBrightness = jest.fn<void, [number]>();
  const setKeepAwake = jest.fn<void, [boolean]>();
  const setSensorsEnabled = jest.fn<void, [boolean]>();
  const getBrightness = jest.fn<Brightness | null, []>(() => initial);
  const backend: PowerSaverBackend = {
    getBrightness,
    setBrightness,
    setKeepAwake,
    setSensorsEnabled,
  };
  return {
    backend,
    setBrightness,
    setKeepAwake,
    setSensorsEnabled,
    getBrightness,
  };
}

describe('PowerSaverService', () => {
  it('dims, keeps awake and disables sensors on apply', () => {
    const spy = makeSpyBackend(0.8);
    const service = new PowerSaverService(spy.backend);

    service.apply();

    expect(service.isActive).toBe(true);
    expect(spy.getBrightness).toHaveBeenCalledTimes(1);
    expect(spy.setBrightness).toHaveBeenCalledWith(DIM_BRIGHTNESS);
    expect(spy.setKeepAwake).toHaveBeenCalledWith(true);
    expect(spy.setSensorsEnabled).toHaveBeenCalledWith(false);
  });

  it('restores the captured brightness and re-enables on restore', () => {
    const spy = makeSpyBackend(0.8);
    const service = new PowerSaverService(spy.backend);

    service.apply();
    spy.setBrightness.mockClear();

    service.restore();

    expect(service.isActive).toBe(false);
    expect(spy.setBrightness).toHaveBeenCalledTimes(1);
    expect(spy.setBrightness).toHaveBeenCalledWith(0.8);
    expect(spy.setKeepAwake).toHaveBeenLastCalledWith(false);
    expect(spy.setSensorsEnabled).toHaveBeenLastCalledWith(true);
  });

  it('falls back to the default brightness when the platform cannot report it', () => {
    const spy = makeSpyBackend(null);
    const service = new PowerSaverService(spy.backend);

    service.apply();
    spy.setBrightness.mockClear();
    service.restore();

    expect(spy.setBrightness).toHaveBeenCalledWith(DEFAULT_RESTORE_BRIGHTNESS);
  });

  it('is idempotent on apply: a second apply does not re-capture brightness', () => {
    const spy = makeSpyBackend(0.8);
    const service = new PowerSaverService(spy.backend);

    service.apply();
    service.apply();

    expect(spy.getBrightness).toHaveBeenCalledTimes(1);
    expect(spy.setKeepAwake).toHaveBeenCalledTimes(1);
  });

  it('restores exactly once: a second restore is a no-op', () => {
    const spy = makeSpyBackend(0.8);
    const service = new PowerSaverService(spy.backend);

    service.apply();
    spy.setKeepAwake.mockClear();

    service.restore();
    service.restore();

    // Only the first restore released the lock.
    expect(spy.setKeepAwake).toHaveBeenCalledTimes(1);
    expect(spy.setKeepAwake).toHaveBeenCalledWith(false);
  });

  it('restore without a prior apply is a safe no-op', () => {
    const spy = makeSpyBackend(0.8);
    const service = new PowerSaverService(spy.backend);

    expect(() => service.restore()).not.toThrow();
    expect(spy.setBrightness).not.toHaveBeenCalled();
    expect(spy.setKeepAwake).not.toHaveBeenCalled();
  });

  it('re-captures brightness on a fresh apply after restore', () => {
    const spy = makeSpyBackend(0.8);
    const service = new PowerSaverService(spy.backend);

    service.apply();
    service.restore();
    service.apply();

    expect(spy.getBrightness).toHaveBeenCalledTimes(2);
    expect(service.isActive).toBe(true);
  });

  it('does not throw when the backend methods throw (errors are swallowed)', () => {
    const throwing: PowerSaverBackend = {
      getBrightness: () => {
        throw new Error('no native');
      },
      setBrightness: () => {
        throw new Error('no native');
      },
      setKeepAwake: () => {
        throw new Error('no native');
      },
      setSensorsEnabled: () => {
        throw new Error('no native');
      },
    };
    const service = new PowerSaverService(throwing);

    expect(() => service.apply()).not.toThrow();
    expect(() => service.restore()).not.toThrow();
  });

  it('uses the safe no-op backend by default (no native module required)', () => {
    const service = createPowerSaverService();

    expect(() => {
      service.apply();
      service.restore();
    }).not.toThrow();
    expect(noopBackend.getBrightness()).toBeNull();
  });
});
