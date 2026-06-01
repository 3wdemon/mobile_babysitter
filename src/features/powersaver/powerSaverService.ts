/**
 * powerSaverService — orchestrates the baby-unit low-power posture (DMY-12).
 *
 * Responsibilities (all via the abstract {@link PowerSaverBackend}):
 *  - `apply()`   — capture the current brightness, dim the screen to
 *    {@link DIM_BRIGHTNESS}, keep the display awake (on-but-dark) and disable
 *    non-essential sensors. Idempotent: calling it twice does not re-capture the
 *    (already-dimmed) brightness or re-run the effects.
 *  - `restore()` — put brightness back to the captured value, release the
 *    keep-awake lock and re-enable sensors. Idempotent: a `restore()` with no
 *    prior `apply()`, or a second `restore()`, is a safe no-op.
 *
 * Design boundary (HONEST): the JS layer owns ONLY the sequencing, snapshot and
 * idempotency. The actual brightness/keep-awake/sensor control is whatever
 * backend is injected. The default backend is a SAFE NO-OP — there is NO real
 * hardware integration shipped in this issue; a native bridge plugs into the
 * exact same {@link PowerSaverBackend} contract later (see module docs). Nothing
 * here ever throws: every backend call is wrapped so a flaky native module
 * cannot crash a monitoring session.
 *
 * Privacy: logs only coarse, non-PII facts ("applied"/"restored"); never any
 * media, ids or audio.
 */
import { logger } from '../../services/logger';
import {
  clampBrightness,
  DEFAULT_RESTORE_BRIGHTNESS,
  DIM_BRIGHTNESS,
} from './config';
import type {
  Brightness,
  PowerSaverBackend,
  PowerSaverSnapshot,
} from './types';

/**
 * Default backend: a safe no-op used when no native module is available (e.g.
 * under Jest, in a bare JS context, or before the native bridge is wired). It
 * satisfies the contract without touching any device API.
 */
export const noopBackend: PowerSaverBackend = {
  getBrightness: () => null,
  setBrightness: () => {},
  setKeepAwake: () => {},
  setSensorsEnabled: () => {},
};

/** Run a backend call, swallowing+logging any error so it never propagates. */
function safe(label: string, fn: () => void): void {
  try {
    fn();
  } catch {
    // Coarse, non-PII diagnostic only.
    logger.warn('powersaver: backend call failed', { op: label });
  }
}

/**
 * A stateful power-saver controller. Create one per baby-unit session (the hook
 * does this) and drive it with {@link apply} / {@link restore}.
 */
export class PowerSaverService {
  private readonly backend: PowerSaverBackend;

  /** Snapshot captured at `apply()`, or `null` while inactive. */
  private snapshot: PowerSaverSnapshot | null = null;

  constructor(backend: PowerSaverBackend = noopBackend) {
    this.backend = backend;
  }

  /** Whether power-saver is currently applied. */
  get isActive(): boolean {
    return this.snapshot !== null;
  }

  /**
   * Enter the low-power posture. Idempotent — a second call while already active
   * is a no-op (the original brightness snapshot is preserved). Never throws.
   */
  apply(): void {
    if (this.snapshot !== null) {
      return;
    }

    let previousBrightness: Brightness | null = null;
    safe('getBrightness', () => {
      const current = this.backend.getBrightness();
      previousBrightness = current === null ? null : clampBrightness(current);
    });
    this.snapshot = { previousBrightness };

    safe('setBrightness', () =>
      this.backend.setBrightness(clampBrightness(DIM_BRIGHTNESS)),
    );
    // Keep the display on (but dimmed) so the monitor session / preview survive.
    safe('setKeepAwake', () => this.backend.setKeepAwake(true));
    // Cut non-essential sensors the monitor does not use.
    safe('setSensorsEnabled', () => this.backend.setSensorsEnabled(false));

    logger.info('powersaver: applied', { dimTo: DIM_BRIGHTNESS });
  }

  /**
   * Leave the low-power posture, restoring brightness, releasing keep-awake and
   * re-enabling sensors. Idempotent — calling it without a prior `apply()`, or
   * twice, is a safe no-op. Never throws.
   */
  restore(): void {
    if (this.snapshot === null) {
      return;
    }

    const { previousBrightness } = this.snapshot;
    const target =
      previousBrightness === null
        ? DEFAULT_RESTORE_BRIGHTNESS
        : previousBrightness;

    safe('setBrightness', () =>
      this.backend.setBrightness(clampBrightness(target)),
    );
    safe('setKeepAwake', () => this.backend.setKeepAwake(false));
    safe('setSensorsEnabled', () => this.backend.setSensorsEnabled(true));

    this.snapshot = null;
    logger.info('powersaver: restored');
  }
}

/**
 * Convenience factory mirroring the project's service-style constructors.
 */
export function createPowerSaverService(
  backend?: PowerSaverBackend,
): PowerSaverService {
  return new PowerSaverService(backend);
}
