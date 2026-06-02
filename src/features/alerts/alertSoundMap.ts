/**
 * Per-event-type alert sound + tuning map (DMY-26).
 *
 * This is the heart of the acceptance criterion: EACH {@link AlertType} maps to
 * a DISTINCT sound identifier, so the parent hears a different sound for cry vs
 * motion vs noise vs no-motion. The identifiers are stable, asset-agnostic
 * strings; the real bundled assets behind them are resolved by the
 * {@link AlertSoundPlayer} at the audio integration point (DMY-9).
 *
 * Tuning rationale:
 *
 *  - PRIORITY (cry > no_motion > motion > noise): a baby crying is the most
 *    actionable event a parent wants to hear immediately, so it ranks highest
 *    and may preempt anything else. Prolonged stillness (`no_motion`) ranks
 *    next: it is a low-frequency but safety-relevant signal, more important than
 *    a transient `motion` or ambient `noise`. `motion` outranks `noise` because
 *    "the baby moved" is usually more meaningful than ambient room noise.
 *
 *  - COOLDOWN (per type): suppresses same-type spam.
 *    * `cry` 5s — short, so a genuinely continuing cry re-alerts promptly.
 *    * `motion` 10s — motion tends to come in bursts; 10s avoids a flurry.
 *    * `noise` 8s — ambient noise spikes can repeat; a slightly longer gap than
 *      cry but shorter than motion.
 *    * `no_motion` 60s — the detector itself only fires once per still stretch
 *      (>30s), so re-alerting more than once a minute would be noise.
 *
 *  - VOLUME: urgent alerts louder than ambient ones (cry loudest, noise
 *    quietest). Hints only; ignored by the no-op player until DMY-9.
 *
 * NO_MOTION DECISION: we DO treat `no_motion` as an alert with its OWN sound.
 * Per the product-spec, "absence of movement >30s" is an explicit detection
 * signal a parent may want surfaced, and reusing the `motion` sound would be
 * actively misleading (opposite meaning). Giving it a distinct, lower-urgency
 * sound lets the parent recognise it without alarm fatigue. Consumers that find
 * stillness reassuring rather than alarming can simply not subscribe `no_motion`
 * (the hook filters by type) — but the mapping is defined so the choice is
 * theirs, not blocked by a missing sound.
 */
import type { AlertType, AlertTypeConfig } from './alertTypes';

/**
 * The canonical per-type configuration. Frozen so a stray mutation cannot
 * silently change another event's sound at runtime.
 *
 * Every `soundId` is unique — that uniqueness is asserted by the tests and is
 * the literal acceptance criterion of DMY-26.
 */
export const SOUND_BY_ALERT_TYPE: Readonly<Record<AlertType, AlertTypeConfig>> =
  Object.freeze({
    cry: { soundId: 'alert-cry', priority: 40, cooldownMs: 5000, volume: 1.0 },
    no_motion: {
      soundId: 'alert-no-motion',
      priority: 30,
      cooldownMs: 60000,
      volume: 0.8,
    },
    motion: {
      soundId: 'alert-motion',
      priority: 20,
      cooldownMs: 10000,
      volume: 0.7,
    },
    noise: {
      soundId: 'alert-noise',
      priority: 10,
      cooldownMs: 8000,
      volume: 0.6,
    },
  });

/** Resolve the sound id for an alert type. */
export function soundIdForType(type: AlertType): string {
  return SOUND_BY_ALERT_TYPE[type].soundId;
}

/** Resolve the per-type tuning for an alert type. */
export function configForType(type: AlertType): AlertTypeConfig {
  return SOUND_BY_ALERT_TYPE[type];
}
