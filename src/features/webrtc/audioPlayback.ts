/**
 * audioPlayback — the parent-unit audio routing integration point (DMY-18).
 *
 * When the parent-unit receives the baby-unit's remote audio track over WebRTC,
 * the bytes still have to be ROUTED to a speaker (and, for the overnight use
 * case, kept playing while the screen is locked through an active VoIP/audio
 * session — `react-native-incall-manager` on Android, CallKit on iOS, DMY-9).
 * That device-effect side is abstracted behind {@link AudioPlayback} so the
 * stream-attachment logic stays unit-testable with no native dependency.
 *
 * ## Design boundary (HONEST)
 * react-native-webrtc renders received audio to the default output on its own
 * once a remote track is live, so the SHIPPED default ({@link noopAudioPlayback})
 * is a safe no-op: attaching the remote stream is enough to hear audio in a real
 * build. What it does NOT do — force the loud speaker, hold an audio session
 * alive in the background, manage the proximity sensor / earpiece routing — is
 * the real controller's job and lands with the in-call/VoIP work (DMY-9). The
 * real controller plugs into this exact contract. We do NOT fake any of that
 * here, and `playing` is driven only by a real attach (a genuine `ontrack`),
 * never synthesised.
 *
 * ## Privacy
 * Audio is the most sensitive media we handle. NOTHING about its content is ever
 * logged — only coarse, non-PII lifecycle facts ("audio attached" / "released").
 * No stream/track ids, no sample data.
 */
import { logger } from '../../services/logger';
import type { MediaStreamLike } from './mediaTypes';

/**
 * Device-effect backend for parent-unit audio output. The single integration
 * point for the audio-routing / VoIP-session layer (DMY-9). Every method MUST be
 * safe to call (never throw) and cheap.
 *
 * Honest boundary: the JS layer owns ONLY the lifecycle (which remote stream is
 * attached, and whether playback is active). Whether {@link start} routes to the
 * loud speaker, opens an `AVAudioSession` / `AudioManager` mode, or holds a
 * background VoIP session alive is entirely the controller's concern (DMY-9).
 */
export interface AudioPlayback {
  /**
   * Begin playing the given remote audio stream. Called once a remote audio
   * track has arrived and been attached. Idempotent for the same stream.
   */
  start(stream: MediaStreamLike): void;
  /**
   * Stop playback and release any audio-session resources. Called on teardown /
   * unmount. Idempotent.
   */
  stop(): void;
  /** Mute or unmute local playback (does NOT stop the stream). */
  setMuted(muted: boolean): void;
}

/**
 * Safe no-op playback used when no routing controller is wired (under Jest, in a
 * bare JS context, or before DMY-9). In a real build, react-native-webrtc plays
 * a live remote audio track on the default output without extra work, so this
 * no-op still yields audible audio; it just does not force routing / hold a
 * background session.
 */
export const noopAudioPlayback: AudioPlayback = {
  start: () => {},
  stop: () => {},
  setMuted: () => {},
};

/** Run a controller call, swallowing+logging any error so it never propagates. */
function safe(label: string, fn: () => void): void {
  try {
    fn();
  } catch {
    // Coarse, non-PII diagnostic only.
    logger.warn('webrtc/audio: playback call failed', { op: label });
  }
}

/**
 * Wrap an {@link AudioPlayback} so its calls never throw and are logged at a
 * coarse, non-PII level. The hook always drives the wrapped controller.
 *
 * @param playback The real controller (DMY-9) or undefined for the no-op.
 */
export function createSafeAudioPlayback(
  playback: AudioPlayback = noopAudioPlayback,
): AudioPlayback {
  return {
    start: stream => {
      safe('start', () => playback.start(stream));
      logger.info('webrtc/audio: remote audio playback started');
    },
    stop: () => {
      safe('stop', () => playback.stop());
      logger.info('webrtc/audio: remote audio playback stopped');
    },
    setMuted: muted => {
      safe('setMuted', () => playback.setMuted(muted));
      // Boolean flag only — no media content.
      logger.info('webrtc/audio: playback muted state', { muted });
    },
  };
}
