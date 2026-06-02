/**
 * Alert sound player implementations (DMY-26).
 *
 * The real audio engine + bundled sound assets are the integration point and
 * land with the audio work (DMY-9). Until then, the SHIPPED default is a no-op
 * player: it satisfies the {@link AlertSoundPlayer} contract, never throws, and
 * plays nothing — so the alert orchestration (mapping, throttle, dedup,
 * priority) can be wired and tested honestly without faking real playback.
 *
 * When DMY-9 lands, provide a concrete player that resolves a {@link SoundId} to
 * a bundled asset and plays it through the platform audio/VoIP session, then
 * inject it where {@link noopAlertSoundPlayer} is used today.
 */
import { logger } from '../../services/logger';
import type { AlertSoundPlayer, SoundId } from './alertTypes';

/**
 * No-op {@link AlertSoundPlayer}: records intent in the log (privacy-safe — only
 * the sound id, never audio) but produces no sound. Stateless and total.
 */
export const noopAlertSoundPlayer: AlertSoundPlayer = {
  playSound(soundId: SoundId, volume?: number): void {
    // Log only the sound id (+ optional volume) — never any audio/media. This
    // makes the no-op observable in dev without leaking content. Real playback
    // is DMY-9.
    logger.debug('alert: playSound (no-op)', { soundId, volume });
  },
  stop(): void {
    logger.debug('alert: stop (no-op)');
  },
};

/**
 * Factory for a no-op player. Returns the shared stateless instance; exposed as
 * a function so call sites read symmetrically with future real-player factories
 * (e.g. `createCallKitAlertSoundPlayer(...)`) once DMY-9 lands.
 */
export function createNoopAlertSoundPlayer(): AlertSoundPlayer {
  return noopAlertSoundPlayer;
}
