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
 * Where the parent-unit's monitor audio is sent (DMY-55).
 *
 *  - `speaker`   — the loud speakerphone (room-fill; the overnight default).
 *  - `earpiece`  — the quiet receiver held to the ear (discreet listening).
 *  - `bluetooth` — a connected Bluetooth audio device (headset / car / speaker).
 *
 * Selecting a route is a request to the {@link AudioPlayback} controller; the
 * actual switch is performed by the native audio-session layer (Android
 * `react-native-incall-manager`; iOS `AVAudioSession`, DMY-48/A3). The shipped
 * default ({@link noopAudioPlayback}) honours the request as a safe no-op.
 */
export type AudioRoute = 'speaker' | 'earpiece' | 'bluetooth';

/** All routes, in the order the UI presents them. */
export const AUDIO_ROUTES: readonly AudioRoute[] = [
  'speaker',
  'earpiece',
  'bluetooth',
] as const;

/** The route the seam falls back to when none has been chosen yet. */
export const DEFAULT_AUDIO_ROUTE: AudioRoute = 'speaker';

/**
 * Clamp a playback volume onto the inclusive 0..1 range (DMY-56). Non-finite
 * input (`NaN` / `Infinity`) degrades to `0` so a bad value silences rather
 * than crashes or blasts. The single source of truth for the [0,1] contract,
 * shared by the safe wrapper so the controller is always handed a valid scalar.
 */
export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 0;
  }
  return Math.min(1, Math.max(0, volume));
}

/**
 * Device-effect backend for parent-unit audio output. The single integration
 * point for the audio-routing / VoIP-session layer (DMY-9, DMY-48). Every method
 * MUST be safe to call (never throw) and cheap.
 *
 * Honest boundary: the JS layer owns ONLY the lifecycle (which remote stream is
 * attached, whether playback is active, and the REQUESTED output route). Whether
 * {@link start} routes to the loud speaker, opens an `AVAudioSession` /
 * `AudioManager` mode, holds a background VoIP session alive, or actually flips
 * the output to {@link setRoute}'s target is entirely the controller's concern
 * (DMY-9 / DMY-48).
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
  /**
   * Set the playback OUTPUT volume on a normalised 0..1 scale (DMY-56), where
   * `1` is full volume and `0` is fully attenuated. Out-of-range / non-finite
   * inputs are the CALLER's responsibility to clamp (the store/UI already do),
   * but a controller MUST still be defensive. MUST never throw.
   *
   * IMPORTANT: `setVolume(0)` MUTES the OUTPUT but does NOT tear the session
   * down — it is NOT {@link stop}. The remote audio track stays attached and
   * the P2P link stays connected (so detection / alerts keep working and the
   * user can raise the volume again instantly without re-handshaking). Only
   * {@link stop} releases the stream. Idempotent for the same value.
   */
  setVolume(volume: number): void;
  /**
   * Request that monitor audio be routed to `route` (DMY-55). May be sync or
   * async (the native session switch can be a promise). MUST never throw — a
   * controller that cannot honour the route (e.g. Bluetooth dropped mid-switch)
   * should resolve/return without effect rather than reject. Idempotent for the
   * same route.
   */
  setRoute(route: AudioRoute): void | Promise<void>;
  /**
   * Whether a Bluetooth audio output is currently available to route to
   * (DMY-55). The UI uses this to disable/hide the Bluetooth option. The no-op
   * (and any controller before the native session lands) reports `false`.
   */
  isBluetoothAvailable(): boolean;
  /**
   * The routes the user may currently pick from — always includes `speaker` and
   * `earpiece`; includes `bluetooth` only when {@link isBluetoothAvailable}.
   * Derived from `isBluetoothAvailable` by default; a controller may override.
   */
  getAvailableRoutes(): readonly AudioRoute[];
}

/**
 * Compute the routes available given Bluetooth presence. `speaker` + `earpiece`
 * are always present (every phone has both); `bluetooth` only when connected.
 */
export function availableRoutesFor(
  bluetoothAvailable: boolean,
): readonly AudioRoute[] {
  return bluetoothAvailable
    ? AUDIO_ROUTES
    : AUDIO_ROUTES.filter(r => r !== 'bluetooth');
}

/**
 * Safe no-op playback used when no routing controller is wired (under Jest, in a
 * bare JS context, or before DMY-9 / DMY-48). In a real build,
 * react-native-webrtc plays a live remote audio track on the default output
 * without extra work, so this no-op still yields audible audio; it just does not
 * force routing / switch output / hold a background session. With no native
 * audio session it cannot detect Bluetooth, so it reports Bluetooth unavailable
 * and {@link setRoute} is a safe no-op.
 */
export const noopAudioPlayback: AudioPlayback = {
  start: () => {},
  stop: () => {},
  setMuted: () => {},
  setVolume: () => {},
  setRoute: () => {},
  isBluetoothAvailable: () => false,
  getAvailableRoutes: () => availableRoutesFor(false),
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
 * Run a possibly-async controller call, swallowing+logging BOTH a synchronous
 * throw and a rejected promise so neither ever propagates. Used for
 * {@link AudioPlayback.setRoute}, whose native session switch may be async.
 */
function safeAsync(
  label: string,
  fn: () => void | Promise<void>,
): void | Promise<void> {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(undefined, () => {
        logger.warn('webrtc/audio: playback call failed', { op: label });
      });
    }
    return result;
  } catch {
    logger.warn('webrtc/audio: playback call failed', { op: label });
  }
}

/** Read a boolean controller capability, defaulting to `false` if it throws. */
function safeBool(label: string, fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    logger.warn('webrtc/audio: playback call failed', { op: label });
    return false;
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
    setVolume: volume => {
      // Defensive clamp so the controller always gets a valid 0..1 scalar even
      // if a caller bypasses the store/UI clamps. setVolume(0) mutes output but
      // never stops the stream (see AudioPlayback.setVolume docs).
      const clamped = clampVolume(volume);
      safe('setVolume', () => playback.setVolume(clamped));
      // Coarse scalar only — no media content.
      logger.info('webrtc/audio: playback volume set', { volume: clamped });
    },
    setRoute: route => {
      const result = safeAsync('setRoute', () => playback.setRoute(route));
      // The route name is a coarse, non-PII lifecycle fact (no media content).
      logger.info('webrtc/audio: route requested', { route });
      return result;
    },
    isBluetoothAvailable: () =>
      safeBool('isBluetoothAvailable', () => playback.isBluetoothAvailable()),
    getAvailableRoutes: () => {
      try {
        return playback.getAvailableRoutes();
      } catch {
        logger.warn('webrtc/audio: playback call failed', {
          op: 'getAvailableRoutes',
        });
        // Fall back to the always-present routes (no Bluetooth) so the UI still
        // renders a usable control even if the controller misbehaves.
        return availableRoutesFor(false);
      }
    },
  };
}

/**
 * Real-controller scaffold for the native audio session (DMY-9 / DMY-48).
 *
 * HONEST STATUS: the native audio-session module is NOT wired yet — neither
 * `react-native-incall-manager` (Android) nor the iOS `AVAudioSession` bridge
 * (DMY-48/A3) is installed. So this factory does not ship a working native
 * implementation; it exists to keep the seam READY: a controller is injected
 * here, and route changes flow through the same {@link createSafeAudioPlayback}
 * wrapper as everything else. Until the native module lands, callers pass no
 * controller and get {@link noopAudioPlayback} (a safe no-op that reports
 * Bluetooth unavailable).
 *
 * When DMY-48 lands, the native session adapter implements {@link AudioSession}
 * below and `setRoute` maps to e.g. `InCallManager.setForceSpeakerphoneOn(...)`
 * / `chooseAudioRoute(...)`, and `isBluetoothAvailable` reads the live device
 * list. We deliberately do NOT fake any of that here.
 */
export interface AudioSession {
  /** Apply the native output route (speaker / earpiece / bluetooth). */
  applyRoute(route: AudioRoute): void | Promise<void>;
  /** Whether a Bluetooth output device is currently connected. */
  hasBluetooth(): boolean;
}

/**
 * Build an {@link AudioPlayback} that delegates ROUTE control to a native
 * {@link AudioSession}. Lifecycle (start/stop/setMuted) stays a no-op because
 * react-native-webrtc already plays the live remote track on the default
 * output; only routing is the session's job. Wrap with
 * {@link createSafeAudioPlayback} before use so calls never throw.
 *
 * TODO(DMY-48): construct and inject the real `AudioSession` adapter once the
 * native incall-manager / AVAudioSession bridge is installed. Until then no call
 * site uses this — the app runs on {@link noopAudioPlayback}.
 */
export function createAudioSessionPlayback(
  session: AudioSession,
): AudioPlayback {
  return {
    start: () => {},
    stop: () => {},
    setMuted: () => {},
    // Volume scaling is an output-session effect (AudioManager STREAM_VOICE_CALL
    // / AVAudioSession). Until DMY-48 wires the native session it is a no-op here
    // — react-native-webrtc plays the remote track on the default output and the
    // 0..1 preference is held in the store; setVolume(0) mutes WITHOUT stopping.
    // TODO(DMY-48): map onto the native session's output-volume control.
    setVolume: () => {},
    setRoute: route => session.applyRoute(route),
    isBluetoothAvailable: () => session.hasBluetooth(),
    getAvailableRoutes: () => availableRoutesFor(session.hasBluetooth()),
  };
}
