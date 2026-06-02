/**
 * Types for smart alerts on the parent-unit (DMY-26).
 *
 * The alert layer turns privacy-safe DETECTION events (noise — DMY-8, motion /
 * no-motion — DMY-25, cry — DMY-21) into ALERTS that play a DIFFERENT sound per
 * event type on the parent device. It is the bridge between "something was
 * detected on the baby-unit" and "the parent is notified".
 *
 * Privacy: an {@link AlertEvent} carries ONLY the alert type and a timestamp —
 * never audio, frames, raw detection metrics that could leak content, or any
 * media. The detection metric (loudness/motion scalar) is deliberately dropped
 * at this boundary: the parent needs to know WHAT happened and WHEN, not the raw
 * sensor reading. Nothing here is stored to disk or sent over the network.
 *
 * Real sound-asset playback is abstracted behind {@link AlertSoundPlayer} (see
 * `alertSoundPlayer.ts`); wiring an actual audio engine + bundled sound assets
 * is the integration point and lands with the audio work (DMY-9). This module
 * only decides WHICH sound identifier to play, and the alert orchestration
 * (throttle / dedup / priority) around it.
 */

/**
 * The kinds of event that can raise an alert on the parent-unit.
 *
 *  - `'cry'`       — the on-device cry detector fired (DMY-21, blocked-external
 *    on the ML model). The type is wired here NOW so the mapping/priority/sound
 *    are ready the moment the detector lands; nothing emits `cry` yet.
 *  - `'motion'`    — motion was detected in front of the baby-unit camera
 *    (DMY-25 `MotionEvent` of type `'motion'`).
 *  - `'noise'`     — loudness crossed the noise threshold (DMY-8 `NoiseEvent`).
 *  - `'no_motion'` — no motion for >30s of continuous stillness (DMY-25
 *    `MotionEvent` of type `'no_motion'`).
 *
 * `no_motion` IS treated as an alert (see {@link SOUND_BY_ALERT_TYPE} rationale
 * in `alertSoundMap.ts`): prolonged stillness is a safety-relevant signal a
 * parent may want surfaced, so it gets its OWN distinct sound — never reusing
 * the `motion` sound, which would be misleading.
 */
export type AlertType = 'cry' | 'motion' | 'noise' | 'no_motion';

/**
 * Opaque identifier for a bundled alert sound asset.
 *
 * This is intentionally a string id (e.g. `'alert-cry'`), NOT a file handle or
 * audio buffer: the alert layer never owns media. The real asset resolution
 * (id -> bundled `.mp3`/`.caf` -> playback) is the {@link AlertSoundPlayer}'s
 * job and lands with the audio integration (DMY-9).
 */
export type SoundId = string;

/**
 * A raised alert. Privacy-first: type + when, nothing else. No metric, no media.
 */
export interface AlertEvent {
  /** Which kind of event raised this alert. */
  readonly type: AlertType;
  /** Epoch milliseconds at which the alert was raised. */
  readonly timestamp: number;
  /** The sound identifier chosen for this alert type (for UI/log context). */
  readonly soundId: SoundId;
}

/**
 * Per-alert-type tuning used by the orchestration in `alertService.ts`.
 *
 *  - `soundId`  — the DISTINCT sound asset id for this type (key acceptance
 *    criterion: each type maps to a different sound).
 *  - `priority` — higher wins when two alerts are eligible at (nearly) the same
 *    time. A higher-priority alert may preempt/replace a lower one that is
 *    currently playing; a lower-priority alert is dropped while a higher one is
 *    still sounding. `cry` is the most urgent.
 *  - `cooldownMs` — minimum time between two alerts OF THE SAME TYPE, so a
 *    sustained source (repeated noise spikes, ongoing motion) does not spam the
 *    parent with the same sound. Per-type because the right cadence differs
 *    (a recurring cry should re-alert sooner than recurring motion).
 *  - `volume` — optional 0..1 playback volume hint passed to the player; the
 *    no-op player ignores it. Lets urgent alerts (cry) be louder than ambient
 *    ones (noise) once real playback lands (DMY-9).
 */
export interface AlertTypeConfig {
  readonly soundId: SoundId;
  readonly priority: number;
  readonly cooldownMs: number;
  readonly volume?: number;
}

/**
 * Abstraction over the real sound engine (integration point — DMY-9).
 *
 * The alert orchestration depends ONLY on this interface, never on a concrete
 * audio library. In production a real implementation maps {@link SoundId}s onto
 * bundled assets and plays them through the platform audio session (respecting
 * the VoIP/CallKit session — DMY-9); in tests a spy implementation records the
 * calls; the shipped default is a no-op so the feature is safe to wire before
 * the audio engine exists. No audio data crosses this boundary — only a sound
 * id and an optional volume hint.
 */
export interface AlertSoundPlayer {
  /**
   * Play the sound identified by `soundId`. Implementations decide whether a
   * new play preempts a currently-playing one; the orchestration calls this at
   * most once per accepted alert. `volume` is an optional 0..1 hint.
   */
  playSound(soundId: SoundId, volume?: number): void;
  /** Stop any currently-playing alert sound. Safe to call when nothing plays. */
  stop(): void;
}
