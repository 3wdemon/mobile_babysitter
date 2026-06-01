/**
 * Types for the baby-unit power-saver mode (DMY-12).
 *
 * The baby-unit runs for hours (often overnight, on a charger) while streaming
 * audio/video. The product-spec calls for a low-power posture: a dimmed screen,
 * the display kept awake (so the stream/foreground service keeps running) yet
 * visually dark, and disabling sensors the monitor does not need.
 *
 * The real screen-brightness / keep-awake / sensor control requires a native
 * module. To keep the orchestration logic testable WITHOUT pulling in a heavy
 * native dependency, all device effects are funnelled through the abstract
 * {@link PowerSaverBackend} below. Production wires a real native backend (a
 * thin brightness + keep-awake bridge); tests inject a spy; and when no native
 * module is present the service falls back to a safe no-op so nothing throws.
 */

/**
 * Normalised screen brightness on a 0..1 scale.
 *  - `0`  — minimum (darkest the OS allows while still on).
 *  - `1`  — maximum.
 * The baby-unit power-saver targets a low value (see {@link DIM_BRIGHTNESS}).
 */
export type Brightness = number;

/**
 * Device-effect backend for power-saver. This is the single integration point
 * for the native module; every method MUST be safe to call (never throw) and is
 * expected to be cheap. A no-op implementation is a valid backend.
 *
 * All methods are synchronous from the caller's perspective: the service does
 * not await them. A native bridge may dispatch asynchronously internally, but
 * must not surface rejections to the caller (it should swallow + log).
 */
export interface PowerSaverBackend {
  /**
   * Read the current screen brightness (0..1) so it can be restored later.
   * Returns `null` when the platform cannot report it (the service then simply
   * restores to {@link DEFAULT_RESTORE_BRIGHTNESS} on exit).
   */
  getBrightness(): Brightness | null;
  /** Set the screen brightness (0..1). Out-of-range values are clamped. */
  setBrightness(value: Brightness): void;
  /**
   * Keep the screen awake (`true`) or release the lock (`false`). While the
   * monitor session is active the display must NOT auto-sleep — it stays on but
   * dimmed so the foreground service / preview keep running.
   */
  setKeepAwake(keepAwake: boolean): void;
  /**
   * Toggle non-essential sensors the monitor does not need (e.g. proximity,
   * ambient-light auto-brightness, accelerometer-driven rotation). `false`
   * disables them to cut power; `true` restores normal behaviour. Honestly a
   * coarse hint into the native layer — the JS side does not enumerate sensors.
   */
  setSensorsEnabled(enabled: boolean): void;
}

/** Snapshot captured when power-saver is applied, used to restore on exit. */
export interface PowerSaverSnapshot {
  /** Brightness observed before dimming, or `null` if unknown. */
  readonly previousBrightness: Brightness | null;
}
