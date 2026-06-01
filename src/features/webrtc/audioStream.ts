/**
 * audioStream — capture and routing helpers for the baby→parent audio path
 * (DMY-18).
 *
 * This module owns the small, testable pieces of the one-way audio stream:
 *   - baby-unit: {@link getLocalAudioStream} captures the microphone via
 *     `getUserMedia({ audio: true, video: false })` — audio only, the camera is
 *     NEVER powered up for this issue;
 *   - {@link stopStream} releases every track (frees the mic) on teardown;
 *   - {@link extractRemoteAudioStream} pulls the remote audio `MediaStream` out
 *     of an `ontrack` event on the parent side;
 *   - {@link assertEncryptedMediaProfile} inspects an SDP and reports whether the
 *     negotiated media profile is the encrypted DTLS-SRTP one (it always is for
 *     WebRTC — this is a diagnostic/assertion hook, see below).
 *
 * ## Native boundary (HONEST)
 * `mediaDevices` is injected (defaulting to the real react-native-webrtc one,
 * lazily required so importing this under Jest does not pull the native side).
 * Tests pass a fake. We perform the REAL capture against whatever `mediaDevices`
 * we are given; we never synthesise a stream or a "playing" state.
 *
 * ## Encryption (DTLS-SRTP)
 * WebRTC media is encrypted by construction: the only RTP profiles an
 * `RTCPeerConnection` will negotiate are the SRTP ones (`UDP/TLS/RTP/SAVPF`,
 * `RTP/SAVPF`, etc.), with DTLS handling the key exchange. There is no public
 * API to disable this, and plaintext `RTP/AVP` is rejected during SDP
 * negotiation. We therefore do not "enable" encryption — we just never opt out
 * (we cannot) and provide {@link assertEncryptedMediaProfile} so a test or a
 * runtime diagnostic can confirm the negotiated profile is SRTP, not plaintext.
 *
 * ## Privacy
 * Audio content is never logged — only coarse lifecycle facts. SDP is sensitive
 * network metadata and is never logged raw (the redactor masks the `sdp` key).
 */
import { logger } from '../../services/logger';
import type {
  MediaDevicesLike,
  MediaEncryptionProfile,
  MediaStreamLike,
  MediaStreamTrackLike,
  TrackEventLike,
} from './mediaTypes';

/**
 * Audio-only capture constraints. Video is EXPLICITLY false: this issue ships
 * audio→parent only and the camera must not be activated (battery/privacy).
 */
export const AUDIO_ONLY_CONSTRAINTS = { audio: true, video: false } as const;

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
    logger.warn('webrtc/audio: react-native-webrtc mediaDevices unavailable');
    return null;
  }
}

/**
 * Capture the local microphone as an audio-only {@link MediaStreamLike}
 * (baby-unit). Requests `{ audio: true, video: false }` — the camera is never
 * powered up. The returned stream's audio track is added to the peer connection
 * by the caller.
 *
 * @param mediaDevices Injected media-devices source. Defaults to the lazily
 *   resolved native one; tests pass a fake.
 * @throws if no `mediaDevices` is available, or if the user denies the mic.
 */
export async function getLocalAudioStream(
  mediaDevices: MediaDevicesLike | null = resolveNativeMediaDevices(),
): Promise<MediaStreamLike> {
  if (!mediaDevices) {
    throw new Error(
      'webrtc/audio: no mediaDevices available (native module missing)',
    );
  }
  const stream = await mediaDevices.getUserMedia(AUDIO_ONLY_CONSTRAINTS);
  logger.info('webrtc/audio: local audio stream captured');
  return stream;
}

/**
 * Return the audio tracks of a stream, tolerating a backend that lacks the
 * `getAudioTracks` helper by filtering `getTracks()` on `kind === 'audio'`.
 */
export function audioTracksOf(stream: MediaStreamLike): MediaStreamTrackLike[] {
  if (typeof stream.getAudioTracks === 'function') {
    return stream.getAudioTracks();
  }
  return stream.getTracks().filter(t => t.kind === 'audio');
}

/**
 * Stop every track on a stream, releasing the underlying capture device(s).
 * Essential on teardown so the microphone is freed (no leak / stuck red dot).
 * Total: a throwing `stop()` on one track does not abort the rest.
 */
export function stopStream(stream: MediaStreamLike | null | undefined): void {
  if (!stream) {
    return;
  }
  let stopped = 0;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
      stopped += 1;
    } catch {
      logger.warn('webrtc/audio: failed to stop a track');
    }
  }
  if (stopped > 0) {
    logger.info('webrtc/audio: stopped local tracks', { count: stopped });
  }
}

/**
 * Set `enabled` on every audio track of a stream (mute = `enabled:false`).
 * Muting via the track flag keeps the SRTP session alive (silence is sent) and
 * is instantly reversible, unlike `stop()`. Returns how many tracks changed.
 */
export function setStreamAudioEnabled(
  stream: MediaStreamLike | null | undefined,
  enabled: boolean,
): number {
  if (!stream) {
    return 0;
  }
  let changed = 0;
  for (const track of audioTracksOf(stream)) {
    track.enabled = enabled;
    changed += 1;
  }
  return changed;
}

/**
 * Extract the remote audio {@link MediaStreamLike} from an `ontrack` event
 * (parent-unit). Prefers the event's `streams[0]`; falls back to wrapping the
 * receiver/track. Returns `null` if the event carries no audio track — so the
 * caller only marks playback active on a REAL audio arrival, never fabricated.
 */
export function extractRemoteAudioStream(
  event: TrackEventLike | null | undefined,
): MediaStreamLike | null {
  if (!event) {
    return null;
  }
  const track = event.track ?? event.receiver?.track;
  // An explicit non-audio track means this event is not the audio we want.
  if (track && track.kind !== 'audio') {
    return null;
  }

  const stream = event.streams?.[0];
  if (stream && audioTracksOf(stream).length > 0) {
    return stream;
  }

  // No usable stream on the event, but we have a bare audio track: wrap it in a
  // minimal stream so playback has something to attach.
  if (track && track.kind === 'audio') {
    const single: MediaStreamLike = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    };
    return single;
  }
  return null;
}

/**
 * The SRTP-family media profile tokens. Any of these means the media is carried
 * over SRTP (encrypted). The non-`S` profiles (`RTP/AVP`, `RTP/AVPF`) are the
 * INSECURE ones WebRTC refuses to negotiate.
 */
const SECURE_PROFILE_RE = /\bS?(?:RTP|UDP)\/?.*?SAVPF?\b/i;
const MEDIA_LINE_RE = /^m=(audio|video|application)\s+\d+\s+(\S+)/gm;

/**
 * Inspect an SDP blob and report whether every media (`m=`) line uses an
 * encrypted SRTP profile (DTLS-SRTP), as opposed to plaintext `RTP/AVP`.
 *
 * For any real WebRTC offer/answer this returns `{ encrypted: true }`: the stack
 * only ever offers `UDP/TLS/RTP/SAVPF`. This exists so a test/diagnostic can
 * ASSERT the encrypted path and would catch a (hypothetical) regression to
 * plaintext. With no media lines it reports `encrypted: false` (nothing to
 * secure, treated conservatively as not-yet-encrypted).
 *
 * Does NOT log the SDP (sensitive); returns a coarse, non-PII summary only.
 */
export function assertEncryptedMediaProfile(
  sdp: string | null | undefined,
): MediaEncryptionProfile {
  const profiles: string[] = [];
  if (!sdp) {
    return { encrypted: false, profiles };
  }
  let match: RegExpExecArray | null;
  MEDIA_LINE_RE.lastIndex = 0;
  let allSecure = true;
  let sawMedia = false;
  while ((match = MEDIA_LINE_RE.exec(sdp)) !== null) {
    sawMedia = true;
    const profile = match[2];
    profiles.push(profile);
    if (!SECURE_PROFILE_RE.test(profile)) {
      allSecure = false;
    }
  }
  return { encrypted: sawMedia && allSecure, profiles };
}
