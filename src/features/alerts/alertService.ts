/**
 * Alert orchestration core (DMY-26) — pure, framework-free.
 *
 * Takes privacy-safe DETECTION events (cry / motion / no_motion / noise) and
 * decides whether to raise an ALERT that plays a per-type sound through an
 * injected {@link AlertSoundPlayer}. All the policy lives here:
 *
 *  - MAPPING: each {@link AlertType} -> its distinct {@link SoundId} (the core
 *    acceptance criterion), via {@link SOUND_BY_ALERT_TYPE}.
 *  - ENABLEMENT: respects `settings.alertSoundsEnabled` — when alerts are off,
 *    nothing is played (no sound, no preempt).
 *  - THROTTLE / DEDUP: a per-type cooldown drops a repeat of the SAME type that
 *    arrives within its `cooldownMs`, so a sustained source does not spam the
 *    parent with the same sound.
 *  - PRIORITY: when a higher-priority type arrives while a lower-priority alert
 *    is still within its "sounding" window, the higher one preempts it; a
 *    lower-priority type that arrives while a higher one is sounding is dropped.
 *    (`cry` > `no_motion` > `motion` > `noise`.)
 *
 * It is deliberately a plain class with an injected clock so it is fully
 * deterministic and testable without React or timers. The React glue lives in
 * `useAlerts.ts`.
 *
 * Privacy: it only ever sees/emits a type + timestamp. No metric, audio, frame
 * or media crosses into the service or out of it. Logs carry only type/soundId.
 */
import { logger } from '../../services/logger';
import { configForType } from './alertSoundMap';
import type {
  AlertEvent,
  AlertSoundPlayer,
  AlertType,
} from './alertTypes';

/** A clock function returning epoch milliseconds. Injectable for tests. */
export type Clock = () => number;

/** Options for {@link createAlertService}. */
export interface AlertServiceOptions {
  /** Sink that actually plays the chosen sound. Defaults to the no-op player. */
  readonly player: AlertSoundPlayer;
  /**
   * Reads the CURRENT enablement (so the service always honours the latest
   * `settings.alertSoundsEnabled` without being re-created). Defaults to always
   * enabled.
   */
  readonly isEnabled?: () => boolean;
  /** Time source, epoch ms. Defaults to `Date.now`. Injectable for tests. */
  readonly now?: Clock;
}

/** Reason an incoming detection did not raise an audible alert. */
export type AlertDropReason = 'disabled' | 'cooldown' | 'priority';

/** Result of feeding one detection event into the service. */
export interface AlertResult {
  /** The alert that was raised (and whose sound was played), or `null`. */
  readonly event: AlertEvent | null;
  /** Why nothing was played, when `event` is `null`. */
  readonly droppedReason: AlertDropReason | null;
}

const DROPPED = (reason: AlertDropReason): AlertResult => ({
  event: null,
  droppedReason: reason,
});

/**
 * Orchestrates detection -> alert. One instance per parent monitoring session.
 */
export class AlertService {
  private readonly player: AlertSoundPlayer;
  private readonly isEnabled: () => boolean;
  private readonly now: Clock;

  /** Last time (ms) each type raised an alert, for the per-type cooldown. */
  private readonly lastRaisedAt = new Map<AlertType, number>();

  /**
   * The currently-"sounding" alert and the time until which it is considered to
   * still occupy the channel for PRIORITY purposes. We model the sound as
   * occupying the channel for its own type cooldown window; a higher-priority
   * arrival within that window preempts it. `null` once nothing is sounding.
   */
  private active: { type: AlertType; until: number } | null = null;

  /** The most recently raised alert (for UI), or `null`. */
  private last: AlertEvent | null = null;

  constructor(options: AlertServiceOptions) {
    this.player = options.player;
    this.isEnabled = options.isEnabled ?? (() => true);
    this.now = options.now ?? Date.now;
  }

  /** The most recently raised alert, or `null`. */
  get lastAlert(): AlertEvent | null {
    return this.last;
  }

  /**
   * Feed one detection event (already reduced to an {@link AlertType}).
   * Returns whether an alert was raised and, if not, why it was dropped.
   */
  handle(type: AlertType): AlertResult {
    if (!this.isEnabled()) {
      return DROPPED('disabled');
    }

    const t = this.now();
    const cfg = configForType(type);

    // THROTTLE / DEDUP: same type within its cooldown is suppressed.
    const prev = this.lastRaisedAt.get(type);
    if (prev !== undefined && t - prev < cfg.cooldownMs) {
      return DROPPED('cooldown');
    }

    // PRIORITY: if something is still sounding, only a strictly-higher priority
    // type may take over; equal/lower is dropped. An expired `active` (its
    // window elapsed) no longer blocks anything.
    if (this.active && t < this.active.until) {
      const activePriority = configForType(this.active.type).priority;
      if (cfg.priority <= activePriority) {
        return DROPPED('priority');
      }
      // Preempt the lower-priority sound before starting the new one.
      this.player.stop();
    }

    // Raise the alert: play the distinct per-type sound.
    const event: AlertEvent = {
      type,
      timestamp: t,
      soundId: cfg.soundId,
    };
    this.player.playSound(cfg.soundId, cfg.volume);

    this.lastRaisedAt.set(type, t);
    this.active = { type, until: t + cfg.cooldownMs };
    this.last = event;

    // Privacy: log only type + soundId, never any metric/audio.
    logger.info('alert: raised', { type, soundId: cfg.soundId });

    return { event, droppedReason: null };
  }

  /** Stop any sounding alert and clear the active channel. */
  stop(): void {
    this.player.stop();
    this.active = null;
  }

  /** Clear cooldown/priority/last state. Use when (re)starting a session. */
  reset(): void {
    this.lastRaisedAt.clear();
    this.active = null;
    this.last = null;
  }
}

/** Convenience factory mirroring the other detection feature factories. */
export function createAlertService(options: AlertServiceOptions): AlertService {
  return new AlertService(options);
}
