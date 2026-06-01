/**
 * videoStream — capture, publish, render and adaptive-bitrate control for the
 * one-way baby→parent VIDEO path (DMY-17).
 *
 * This module owns the small, testable pieces of the video stream on top of the
 * signalling/peer-connection layer (DMY-16) and mirrors the audio module
 * (DMY-18):
 *   - baby-unit: {@link getLocalVideoStream} captures the camera via
 *     `getUserMedia` at 1080p (with an automatic step-down if the device cannot
 *     deliver it); {@link videoTracksOf} enumerates the video tracks the caller
 *     publishes (sendonly) onto the connection;
 *   - parent-unit: {@link extractRemoteVideoStream} pulls the remote video
 *     `MediaStream` out of an `ontrack` event, and {@link streamUrlOf} yields the
 *     id `RTCView` renders;
 *   - adaptive bitrate: {@link setVideoBitrate} and {@link nextBitrateProfile}
 *     reshape an `RTCRtpSender`'s encodings (maxBitrate / scaleResolutionDownBy /
 *     degradationPreference) to step quality DOWN under bandwidth pressure and
 *     back UP when it recovers — all via `setParameters`, which changes the
 *     encoding in place and NEVER tears the SRTP session down.
 *
 * ## Native boundary (HONEST)
 * `mediaDevices` is injected (defaulting to the real react-native-webrtc one,
 * lazily required so importing this under Jest does not pull the native side);
 * tests pass a fake. We perform the REAL capture against whatever `mediaDevices`
 * we are given, and shape the REAL sender we are handed; we never synthesise a
 * stream, a sender, or a "playing" state. Whether two phones on a real network
 * actually exchange frames cannot be exercised here (no devices / network) and
 * is a manual verification milestone — but every seam used to do so is real.
 *
 * ## Encryption (DTLS-SRTP)
 * As with audio, WebRTC video is encrypted by construction: the video m-line
 * carries SRTP (`UDP/TLS/RTP/SAVPF`) and there is no API to send it in the
 * clear. {@link assertEncryptedMediaProfile} (audioStream.ts) already inspects
 * EVERY `m=` line — audio AND video — so the video media is covered.
 *
 * ## Privacy
 * Video frames / track ids are never logged — only coarse lifecycle facts and
 * non-PII quality numbers (a bitrate cap, a resolution scale). SDP is never
 * logged raw (the redactor masks the `sdp` key).
 */
import { logger } from '../../services/logger';
import type {
  MediaDevicesLike,
  MediaStreamConstraints,
  MediaStreamLike,
  MediaStreamTrackLike,
  RtpSenderLike,
  TrackEventLike,
  VideoConstraints,
} from './mediaTypes';

/**
 * Full-quality 1080p capture constraints (baby-unit). Rear camera
 * (`environment`) so it watches the crib. We always request audio too (the
 * baby→parent audio path, DMY-18, runs on the same capture) — but note the
 * video stream's tracks are published independently.
 *
 * Plain numbers (no `{ ideal }` wrappers) to match react-native-webrtc's
 * constraint parser.
 */
export const VIDEO_1080P_CONSTRAINTS: VideoConstraints = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  facingMode: 'environment',
};

/**
 * Ordered capture fallbacks, highest first. If the device/camera cannot satisfy
 * 1080p (`getUserMedia` rejects with an OverconstrainedError), we retry at the
 * next lower resolution rather than failing the whole monitor. This is the
 * "degradation if the device cannot deliver" path from the AC.
 */
export const VIDEO_CONSTRAINT_LADDER: readonly VideoConstraints[] = [
  VIDEO_1080P_CONSTRAINTS,
  { width: 1280, height: 720, frameRate: 30, facingMode: 'environment' },
  { width: 640, height: 480, frameRate: 20, facingMode: 'environment' },
];

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
    logger.warn('webrtc/video: react-native-webrtc mediaDevices unavailable');
    return null;
  }
}

/** Result of a local video capture: the stream + which rung it landed on. */
export interface LocalVideoCapture {
  /** The captured stream (camera video, possibly audio too). */
  readonly stream: MediaStreamLike;
  /** The constraints that actually succeeded (the rung used). */
  readonly constraints: VideoConstraints;
  /** `true` if we had to step below the top (1080p) rung. */
  readonly degraded: boolean;
}

/** A getUserMedia error that signals the constraints cannot be met. */
function isOverconstrained(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  const message = String((err as { message?: string } | null)?.message ?? '');
  return (
    name === 'OverconstrainedError' ||
    name === 'ConstraintNotSatisfiedError' ||
    /overconstrained|constraint/i.test(message)
  );
}

/**
 * Capture the local camera as a video stream (baby-unit), targeting 1080p and
 * stepping DOWN through {@link VIDEO_CONSTRAINT_LADDER} if the device cannot
 * deliver the requested resolution. Audio is requested alongside so the single
 * capture also carries the mic (the audio path publishes its own track).
 *
 * The camera is a powered, privacy-sensitive device — the caller MUST
 * {@link stopStream} the returned stream on teardown (see useVideoStream).
 *
 * @param mediaDevices Injected media-devices source. Defaults to the lazily
 *   resolved native one; tests pass a fake.
 * @param ladder Constraint rungs to try, highest first. Defaults to the 1080p
 *   ladder.
 * @throws if no `mediaDevices` is available, the user denies the camera, or
 *   every rung fails for a non-constraint reason.
 */
export async function getLocalVideoStream(
  mediaDevices: MediaDevicesLike | null = resolveNativeMediaDevices(),
  ladder: readonly VideoConstraints[] = VIDEO_CONSTRAINT_LADDER,
): Promise<LocalVideoCapture> {
  if (!mediaDevices) {
    throw new Error(
      'webrtc/video: no mediaDevices available (native module missing)',
    );
  }
  let lastError: unknown;
  for (let i = 0; i < ladder.length; i++) {
    const constraints = ladder[i];
    const request: MediaStreamConstraints = { audio: true, video: constraints };
    try {
      const stream = await mediaDevices.getUserMedia(request);
      const degraded = i > 0;
      // Coarse, non-PII fact only — the chosen resolution, no track ids.
      logger.info('webrtc/video: local video stream captured', {
        width: constraints.width,
        height: constraints.height,
        degraded,
      });
      return { stream, constraints, degraded };
    } catch (err) {
      lastError = err;
      // A pure constraint failure → step down to the next rung. Any other
      // error (e.g. permission denied) is fatal and re-thrown immediately.
      if (!isOverconstrained(err) || i === ladder.length - 1) {
        throw err;
      }
      logger.info('webrtc/video: resolution unsupported, stepping down', {
        width: constraints.width,
        height: constraints.height,
      });
    }
  }
  // Unreachable (the loop either returns or throws), but keeps types total.
  throw (lastError as Error) ?? new Error('webrtc/video: capture failed');
}

/**
 * Return the video tracks of a stream, tolerating a backend that lacks the
 * `getVideoTracks` helper by filtering `getTracks()` on `kind === 'video'`.
 */
export function videoTracksOf(stream: MediaStreamLike): MediaStreamTrackLike[] {
  if (typeof stream.getVideoTracks === 'function') {
    return stream.getVideoTracks();
  }
  return stream.getTracks().filter(t => t.kind === 'video');
}

/**
 * Extract the remote video {@link MediaStreamLike} from an `ontrack` event
 * (parent-unit). Prefers the event's `streams[0]`; falls back to wrapping the
 * receiver/track. Returns `null` if the event carries no video track — so the
 * caller only marks the picture present on a REAL video arrival, never
 * fabricated.
 */
export function extractRemoteVideoStream(
  event: TrackEventLike | null | undefined,
): MediaStreamLike | null {
  if (!event) {
    return null;
  }
  const track = event.track ?? event.receiver?.track;
  // An explicit non-video track means this event is not the video we want.
  if (track && track.kind !== 'video') {
    return null;
  }

  const stream = event.streams?.[0];
  if (stream && videoTracksOf(stream).length > 0) {
    return stream;
  }

  // No usable stream on the event, but we have a bare video track: wrap it in a
  // minimal stream so the render layer has something to attach.
  if (track && track.kind === 'video') {
    const single: MediaStreamLike = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    };
    return single;
  }
  return null;
}

/**
 * The id react-native-webrtc's `RTCView` consumes via its `streamURL` prop. On
 * the native stream this is `stream.toURL()`; a test fake may omit it, in which
 * case we return `null` and the view shows nothing (no faked URL).
 */
export function streamUrlOf(
  stream: MediaStreamLike | null | undefined,
): string | null {
  if (!stream || typeof stream.toURL !== 'function') {
    return null;
  }
  try {
    return stream.toURL();
  } catch {
    logger.warn('webrtc/video: failed to resolve stream URL');
    return null;
  }
}

// --- Adaptive bitrate ------------------------------------------------------

/**
 * One quality rung for the outgoing video encoding. Higher `maxBitrate` and a
 * lower `scaleResolutionDownBy` (1 = native) mean a sharper picture; lower
 * bitrate + higher downscale shed bandwidth under pressure.
 *
 * All numbers are in bits-per-second (`maxBitrate`) and a divisor
 * (`scaleResolutionDownBy`), matching `RTCRtpEncodingParameters`.
 */
export interface VideoQualityProfile {
  /** Human label for diagnostics (non-PII). */
  readonly name: 'high' | 'medium' | 'low';
  /** Encoder bitrate cap in bits per second. */
  readonly maxBitrate: number;
  /** Resolution downscale divisor (1 = full, 2 = half each axis, ...). */
  readonly scaleResolutionDownBy: number;
  /** Frame-rate cap (paired with `maintain-resolution` degradation). */
  readonly maxFramerate: number;
}

/**
 * Quality ladder for 1080p video, highest first. We start at `high` and step
 * DOWN one rung per sustained bandwidth-shortage signal, stepping back UP when
 * the link recovers. Caps are deliberately conservative so the stream prefers
 * to stay connected (the product priority) over staying pretty.
 */
export const VIDEO_QUALITY_LADDER: readonly VideoQualityProfile[] = [
  { name: 'high', maxBitrate: 2_500_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  { name: 'medium', maxBitrate: 1_000_000, scaleResolutionDownBy: 2, maxFramerate: 24 },
  { name: 'low', maxBitrate: 350_000, scaleResolutionDownBy: 4, maxFramerate: 15 },
];

/** Index of the top (highest-quality) rung. */
export const TOP_QUALITY_INDEX = 0;
/** Index of the bottom (lowest-quality) rung. */
export const BOTTOM_QUALITY_INDEX = VIDEO_QUALITY_LADDER.length - 1;

/**
 * Pick the next rung index given the current one and a direction:
 *  - `'down'` steps toward `low` (clamped at the bottom),
 *  - `'up'` steps toward `high` (clamped at the top).
 * Clamping means a sustained-bad or sustained-good link settles, it never
 * runs off the ladder.
 */
export function nextQualityIndex(
  current: number,
  direction: 'up' | 'down',
): number {
  if (direction === 'down') {
    return Math.min(current + 1, BOTTOM_QUALITY_INDEX);
  }
  return Math.max(current - 1, TOP_QUALITY_INDEX);
}

/**
 * Apply a {@link VideoQualityProfile} to an `RTCRtpSender` by mutating its send
 * parameters' first encoding (maxBitrate / scaleResolutionDownBy / maxFramerate)
 * and the degradation preference, then `setParameters`.
 *
 * CRITICAL (AC: "without a disconnect"): `setParameters` reshapes the encoding
 * of the LIVE sender in place — it does NOT renegotiate, re-offer, or recreate
 * the peer connection. The SRTP session, ICE state and media line are untouched;
 * the encoder simply targets a new cap on the next frame. This is the mechanism
 * by which we drop quality under bandwidth pressure with zero interruption.
 *
 * `degradationPreference: 'maintain-framerate'` tells the encoder to shed
 * RESOLUTION rather than frame-rate when it still cannot fit the cap — for a
 * baby monitor, smooth motion (detecting movement) matters more than sharpness.
 *
 * Total: a missing sender, a sender without `getParameters`, or a rejected
 * `setParameters` is swallowed+logged (coarse) so adaptive bitrate can never
 * crash a live monitoring session.
 *
 * @returns `true` if parameters were applied, `false` if there was nothing to
 *   apply to (no sender / no params support).
 */
export async function setVideoBitrate(
  sender: RtpSenderLike | null | undefined,
  profile: VideoQualityProfile,
  degradationPreference: string = 'maintain-framerate',
): Promise<boolean> {
  if (!sender || typeof sender.getParameters !== 'function') {
    return false;
  }
  try {
    const params = sender.getParameters();
    // Ensure there is at least one encoding to shape.
    const encodings =
      Array.isArray(params.encodings) && params.encodings.length > 0
        ? params.encodings
        : [{}];
    encodings[0] = {
      ...encodings[0],
      active: true,
      maxBitrate: profile.maxBitrate,
      scaleResolutionDownBy: profile.scaleResolutionDownBy,
      maxFramerate: profile.maxFramerate,
    };
    const next = {
      ...params,
      encodings,
      degradationPreference,
    };
    await sender.setParameters(next);
    // Coarse, non-PII quality facts only — no track ids / frames.
    logger.info('webrtc/video: bitrate profile applied', {
      profile: profile.name,
      maxBitrate: profile.maxBitrate,
      scaleResolutionDownBy: profile.scaleResolutionDownBy,
    });
    return true;
  } catch {
    logger.warn('webrtc/video: failed to apply bitrate profile');
    return false;
  }
}

// --- Bandwidth signal (abstracted source) ----------------------------------

/**
 * A coarse bandwidth-pressure signal that drives adaptive bitrate:
 *  - `'low'`  — the link is constrained; step quality DOWN.
 *  - `'ok'`   — the link is healthy; step quality UP toward the cap.
 *  - `'hold'` — no change (unknown / transient); keep the current rung.
 *
 * This is deliberately ABSTRACT so the adaptive logic is testable without a real
 * network. Production feeds it from `RTCPeerConnection.getStats()` (outbound RTP
 * `availableOutgoingBitrate`, packet loss, RTT) and/or ICE/connection-state
 * transitions; tests push synthetic signals. The hook never invents a signal —
 * it only reacts to the one its source emits.
 */
export type BandwidthSignal = 'low' | 'ok' | 'hold';

/**
 * Source of {@link BandwidthSignal}s. `subscribe` registers a listener and
 * returns an unsubscribe; the source decides WHEN to emit (a `getStats` poll, an
 * ICE state change, ...). Keeping it a pure interface means the hook depends on
 * NO native stats API and stays unit-testable.
 */
export interface BandwidthSignalSource {
  subscribe(listener: (signal: BandwidthSignal) => void): () => void;
}

/**
 * Map a peer connection-state transition onto a coarse {@link BandwidthSignal}.
 * `disconnected` (ICE struggling / link degraded) → `'low'` so we shed bitrate
 * to help the link recover; `connected` → `'ok'` so we may climb back up; other
 * states hold. This lets the EXISTING connection-state events (DMY-16) act as a
 * zero-dependency bandwidth proxy until a full `getStats` source is wired —
 * which plugs into the same {@link BandwidthSignalSource} seam.
 */
export function bandwidthSignalForState(
  state: string,
): BandwidthSignal {
  switch (state) {
    case 'disconnected':
      return 'low';
    case 'connected':
      return 'ok';
    default:
      return 'hold';
  }
}
