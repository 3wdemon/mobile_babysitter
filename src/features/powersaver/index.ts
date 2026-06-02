/**
 * Public surface of the baby-unit power-saver feature (DMY-12).
 *
 * The actual screen-brightness / keep-awake / sensor control is abstracted
 * behind {@link PowerSaverBackend}; the shipped default is a safe no-op and a
 * native bridge plugs into the same contract later. Nothing here captures media
 * or PII.
 */
export {
  PowerSaverService,
  createPowerSaverService,
  noopBackend,
} from './powerSaverService';
export { usePowerSaver } from './usePowerSaver';
export { default as PowerSaverIndicator } from './PowerSaverIndicator';
export {
  LOW_BATTERY_THRESHOLD,
  UNKNOWN_BATTERY_STATE,
  noopBatterySource,
  computeIsLow,
  makeBatteryState,
  normalizeLevel,
  mapPowerState,
  createSourceFromDeviceInfo,
  createBatterySource,
  getBatterySource,
  __setBatterySource,
} from './batteryStatus';
export {
  DIM_BRIGHTNESS,
  DEFAULT_RESTORE_BRIGHTNESS,
  clampBrightness,
} from './config';
export type { PowerSaverState, UsePowerSaverOptions } from './usePowerSaver';
export type { PowerSaverIndicatorProps } from './PowerSaverIndicator';
export type {
  Brightness,
  PowerSaverBackend,
  PowerSaverSnapshot,
} from './types';
export type {
  BatteryState,
  BatteryListener,
  BatterySource,
  DeviceInfoLike,
} from './batteryStatus';
