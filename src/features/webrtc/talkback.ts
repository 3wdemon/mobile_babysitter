/**
 * talkback — parent→baby push-to-talk capture + controller (DMY-20).
 *
 * The one-way audio path (DMY-18) sends the baby-unit's microphone to the
 * parent. This module adds the REVERSE direction so the parent can talk back to
 * the baby — but only as PUSH-TO-TALK: the parent's microphone is captured and
 * published onto the same peer connection, yet its track is kept DISABLED by
 * default and only enabled while the parent holds the talk button. This makes
 * the link effectively half-duplex (the parent mic is "open" only during talk),
 * which is itself the first and strongest line of defence against acoustic
 * feedback / echo (the two mics are never both live and routed at once).
 *
 * ## Echo cancellation (real, not faked)
 * The parent capture requests {@link TALK_AUDIO_CONSTRAINTS} —
 * `{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }`.
 * These are honoured by react-native-webrtc's native audio processing (WebRTC's
 * AEC3 / APM on both iOS and Android): the platform cancels the far-end signal
 * (the baby-unit audio coming out of the parent's speaker) out of the parent's
 * mic input. We do NOT implement DSP ourselves — we request the native AEC via
 * the standard `getUserMedia` constraints and assert that we did so. Combined
 * with half-duplex push-to-talk, this minimises feedback on the baby-unit.
 *
 * ## Native boundary (HONEST)
 * `mediaDevices` is injected (defaulting to the real react-native-webrtc one,
 * lazily required so importing this under Jest does not pull the native side).
 * Tests pass a fake. We perform the REAL capture against whatever `mediaDevices`
 * we are given and drive the controller's state from the REAL track — we never
 * synthesise a stream or a "talking" state.
 *
 * ## Encryption (DTLS-SRTP)
 * The talkback audio rides the SAME peer connection as the baby→parent audio, so
 * it is carried over the same encrypted DTLS-SRTP session — there is no separate
 * (and no unencrypted) transport. See `assertEncryptedMediaProfile`.
 *
 * ## Privacy
 * Audio content is never logged — only coarse lifecycle facts ("talk capture
 * acquired", "talking", "stopped talking"). No track ids, no sample data.
 */
import { logger } from '../../services/logger';
import { audioTracksOf, stopStream } from './audioStream';
import type {
  AudioConstraints,
  MediaDevicesLike,
  MediaStreamConstraints,
  MediaStreamLike,
} from './mediaTypes';

/**
 * Echo-cancelling audio constraints for the parent push-to-talk capture. Video
 * is EXPLICITLY false (we only ever want the parent's voice, never the camera).
 *
 * - `echoCancellation` — the native AEC cancels the far-end (baby) audio that
 *   leaks back into the parent mic, preventing feedback on the baby-unit.
 * - `noiseSuppression` — drops the parent's room noise so the baby hears a clean
 *   voice.
 * - `autoGainControl` — normalises the parent's level so quiet/loud voices are
 *   evened out before transmission.
 */
export const TALK_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  } as AudioConstraints,
  video: false,
};

/**
 * Lazily resolve the real react-native-webrtc `mediaDevices`. Required through
 * `require` so importing this module under Jest / bare JS does not pull the
 * native side; returns `null` if unavailable.
 */
/* istanbul ignore next -- native resolution; tests inject a fake. */
function resolveNativeMediaDevices(): MediaDevicesLike | null {
  try {
    const mod = require('react-native-webrtc');
    return (mod.mediaDevices ?? null) as MediaDevicesLike | null;
  } catch {
    logger.warn('webrtc/talk: react-native-webrtc mediaDevices unavailable');
    return null;
  }
}

/**
 * Capture the parent's microphone for push-to-talk with native echo
 * cancellation enabled (parent-unit). Requests {@link TALK_AUDIO_CONSTRAINTS}.
 *
 * The returned stream's audio track is added to the peer connection by the
 * caller; the {@link TalkbackController} keeps it disabled until the parent
 * holds the talk button.
 *
 * @param mediaDevices Injected media-devices source. Defaults to the lazily
 *   resolved native one; tests pass a fake.
 * @throws if no `mediaDevices` is available, or if the user denies the mic.
 */
export async function getTalkbackAudioStream(
  mediaDevices: MediaDevicesLike | null = resolveNativeMediaDevices(),
): Promise<MediaStreamLike> {
  if (!mediaDevices) {
    throw new Error(
      'webrtc/talk: no mediaDevices available (native module missing)',
    );
  }
  const stream = await mediaDevices.getUserMedia(TALK_AUDIO_CONSTRAINTS);
  // Coarse, non-PII fact only — no track ids / media content.
  logger.info('webrtc/talk: talk capture acquired (echo cancellation on)');
  return stream;
}

/**
 * Whether a constraints object requests the native echo-cancellation audio
 * processing chain. Used by diagnostics/tests to ASSERT the AEC was requested
 * (the only way we get echo cancellation — we never roll our own DSP).
 */
export function requestsEchoCancellation(
  constraints: MediaStreamConstraints,
): boolean {
  const audio = constraints.audio;
  if (typeof audio !== 'object' || audio === null) {
    return false;
  }
  return audio.echoCancellation === true;
}

/**
 * The push-to-talk controller for the parent's outgoing voice track.
 *
 * Owns exactly the half-duplex talk state on top of an already-captured parent
 * mic stream: the track is DISABLED on creation (nothing is transmitted), goes
 * live only between {@link TalkbackController.startTalking} and
 * {@link TalkbackController.stopTalking}, and is released by
 * {@link TalkbackController.dispose} (which stops the mic — no capture leak).
 */
export interface TalkbackController {
  /** Whether the parent is currently talking (track enabled / transmitting). */
  readonly talking: boolean;
  /** Open the mic: enable the outgoing track so the parent's voice is sent. */
  startTalking(): void;
  /** Close the mic: disable the outgoing track (silence is sent). */
  stopTalking(): void;
  /** Stop the mic track(s) and release the capture device. Idempotent. */
  dispose(): void;
}

/**
 * Build a {@link TalkbackController} over a captured parent mic stream.
 *
 * On creation every audio track is set `enabled = false`: by default the parent
 * mic is NOT transmitting (push-to-talk default-off). `startTalking` flips the
 * track(s) to `enabled = true`; `stopTalking` flips them back to `false`. The
 * track is never `stop()`ed between talks — that keeps the SRTP m-line alive and
 * makes the next talk instant — only `dispose` stops it for good.
 *
 * @param stream The captured parent mic stream (from {@link getTalkbackAudioStream}).
 * @param onTalkingChange Optional callback fired whenever `talking` flips, so a
 *   hook can mirror the state into React without polling.
 */
export function createTalkbackController(
  stream: MediaStreamLike,
  onTalkingChange?: (talking: boolean) => void,
): TalkbackController {
  let talking = false;
  let disposed = false;

  // Default-off: the parent mic transmits nothing until the talk button is held.
  setTalkTracksEnabled(stream, false);

  function setTalking(next: boolean): void {
    if (disposed || talking === next) {
      return;
    }
    talking = next;
    setTalkTracksEnabled(stream, next);
    // Boolean flag only — no media content.
    logger.info('webrtc/talk: talking state', { talking: next });
    onTalkingChange?.(next);
  }

  return {
    get talking() {
      return talking;
    },
    startTalking() {
      setTalking(true);
    },
    stopTalking() {
      setTalking(false);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      talking = false;
      stopStream(stream);
    },
  };
}

/** Set `enabled` on every audio track of the talk stream. */
function setTalkTracksEnabled(stream: MediaStreamLike, enabled: boolean): void {
  for (const track of audioTracksOf(stream)) {
    track.enabled = enabled;
  }
}
