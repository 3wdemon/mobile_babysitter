/**
 * Power-saver tuning constants (DMY-12).
 */
import type { Brightness } from './types';

/**
 * Target brightness while power-saver is active. Low but non-zero so a glance
 * still shows the night-time status UI in a dark nursery, while minimising OLED
 * light emission and battery draw. On a 0..1 scale.
 */
export const DIM_BRIGHTNESS: Brightness = 0.05;

/**
 * Brightness restored on exit when the previous value could not be read from
 * the platform (`getBrightness()` returned `null`). A neutral mid value avoids
 * leaving the user stuck on a near-black screen.
 */
export const DEFAULT_RESTORE_BRIGHTNESS: Brightness = 0.5;

/** Clamp a brightness value into the valid 0..1 range; non-finite -> 0. */
export function clampBrightness(value: number): Brightness {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
