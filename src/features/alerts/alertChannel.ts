/**
 * Alert transport over the WebRTC data channel (DMY-50) — a $0, server-free
 * replacement for push (APNS/FCM, DMY-9).
 *
 * Instead of paying for / depending on a push backend, the baby-unit pushes a
 * raised {@link AlertEvent} to the parent over the SAME live PeerConnection,
 * on a dedicated reliable+ordered {@link DataChannel} (see `peerConnection.ts`).
 * The parent, on receipt, drives the EXISTING in-session sinks: a local
 * notification ({@link AlertNotificationPresenter}, DMY-46) plus a confirmation
 * vibration ({@link HapticFeedback}). This module owns only the WIRE FORMAT and
 * the two thin adapters (send / receive); policy (throttle / snooze / priority)
 * stays in `alertService` upstream of the send.
 *
 * ## Privacy (STRICT)
 * The wire payload is EXACTLY `{ type, timestamp }` — the same minimal shape an
 * {@link AlertEvent} already keeps. NO audio sample, video frame, raw detection
 * metric, loudness/motion scalar, soundId or any media ever crosses the channel.
 * The serializer projects only those two fields; nothing else can leak even if
 * a future AlertEvent grows.
 *
 * ## Honest boundary (vs push) — by design for the MVP
 * This delivers alerts ONLY while BOTH apps are live and the PeerConnection is
 * up ("background WITHIN a live session"). A fully evicted/suspended OS process
 * has no live data channel, so a dead-app wake is NOT covered — that is what
 * real push (DMY-9) would add and is out of scope here. The limitation is
 * deliberate and called out in the PR.
 *
 * ## Robustness (STRICT parse)
 * The receiver validates every inbound message: it must be JSON, an object,
 * with a `type` from the known {@link AlertType} enum and a finite numeric
 * `timestamp`. ANYTHING else (non-JSON, wrong shape, unknown type, NaN time,
 * extra-but-invalid) is DROPPED silently — no notification, no haptic, no throw.
 * A malformed message can never crash the parent or fire a phantom alert.
 */
import { logger } from '../../services/logger';
import type { DataChannel } from '../webrtc/signalingTypes';
import type { AlertNotificationPresenter } from './notificationPresenter';
import { noopNotificationPresenter } from './notificationPresenter';
import type { HapticFeedback } from './hapticFeedback';
import { noopHaptic } from './hapticFeedback';
import type { AlertEvent, AlertType } from './alertTypes';

/**
 * Negotiated label for the alert data channel. Both ends agree on it so the
 * channel's purpose is identified by label, never by sniffing payloads.
 */
export const ALERT_CHANNEL_LABEL = 'baby-monitor-alert';

/**
 * The known alert types, as a runtime set, so the strict parser can reject an
 * unknown discriminant. Kept in lock-step with {@link AlertType}.
 */
const KNOWN_ALERT_TYPES: ReadonlySet<AlertType> = new Set<AlertType>([
  'cry',
  'motion',
  'noise',
  'no_motion',
]);

/**
 * The privacy-safe wire message: EXACTLY `{ type, timestamp }`. This is all the
 * parent needs to notify (WHAT happened and WHEN); deliberately no soundId, no
 * metric, no media.
 */
export interface AlertChannelMessage {
  readonly type: AlertType;
  readonly timestamp: number;
}

/**
 * Serialize a raised {@link AlertEvent} to the privacy-safe wire string.
 *
 * PROJECTS ONLY `type` + `timestamp` — `soundId` and any future field are
 * dropped here, so the channel cannot leak content even as `AlertEvent` grows.
 */
export function serializeAlert(event: AlertEvent): string {
  const message: AlertChannelMessage = {
    type: event.type,
    timestamp: event.timestamp,
  };
  return JSON.stringify(message);
}

/**
 * Parse + STRICTLY validate an inbound wire string into an
 * {@link AlertChannelMessage}, or `null` if it is malformed/unknown.
 *
 * Rejects (returns `null`, never throws) anything that is not valid JSON, not a
 * plain object, lacks a known {@link AlertType} `type`, or lacks a finite
 * numeric `timestamp`. This is the single trust boundary for inbound data.
 */
export function parseAlert(payload: string): AlertChannelMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    // Non-JSON garbage on the channel — drop without throwing.
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as { type?: unknown; timestamp?: unknown };
  if (
    typeof candidate.type !== 'string' ||
    !KNOWN_ALERT_TYPES.has(candidate.type as AlertType)
  ) {
    return null;
  }
  if (
    typeof candidate.timestamp !== 'number' ||
    !Number.isFinite(candidate.timestamp)
  ) {
    return null;
  }
  return { type: candidate.type as AlertType, timestamp: candidate.timestamp };
}

/**
 * Baby-side adapter: push a raised {@link AlertEvent} to the parent over the
 * data channel (DMY-50).
 *
 * Returns whether the payload was handed to the (open) channel. A closed/not-
 * yet-open channel drops the alert (the wrapper logs it) and returns `false`;
 * it never throws, so a flaky channel cannot crash the baby's alert pipeline.
 * The optional `null` channel (data channels unsupported on this connection) is
 * a no-op `false` — alerts-over-datachannel are simply unavailable then.
 */
export function sendAlertOverChannel(
  channel: DataChannel | null,
  event: AlertEvent,
): boolean {
  if (!channel) {
    return false;
  }
  const sent = channel.send(serializeAlert(event));
  if (sent) {
    // Coarse, non-PII: only the type, never the payload string.
    logger.info('alert: sent over datachannel', { type: event.type });
  }
  return sent;
}

/**
 * Baby-side SOURCE seam for the live datachannel wiring (DMY-71).
 *
 * The signalling session, on the baby (responder), opens the alert channel and
 * needs a stream of raised {@link AlertEvent}s to push over it. Rather than
 * coupling the session to a concrete detector, it consumes THIS minimal
 * subscription: `subscribe(handler)` registers a listener for raised alerts and
 * returns an unsubscribe. The real producer is the alert pipeline
 * (cry detection DMY-49 / motion DMY-25 → {@link AlertService}); until that
 * detector is exposed as a stream, callers pass a source they drive themselves
 * (or omit it — then the channel is opened but nothing is pushed yet).
 *
 * Privacy: the handler only ever receives an {@link AlertEvent} (type+timestamp);
 * the serializer further projects to `{type,timestamp}` on the wire.
 */
export interface AlertChannelSource {
  /**
   * Register a listener for raised alerts. Returns an unsubscribe. The session
   * calls this once when the channel opens and unsubscribes on teardown.
   */
  subscribe(handler: (event: AlertEvent) => void): () => void;
}

/**
 * Wire a baby-side {@link AlertChannelSource} to an open alert {@link DataChannel}:
 * every raised {@link AlertEvent} is pushed over the channel via
 * {@link sendAlertOverChannel} (DMY-71). Returns an unsubscribe that detaches the
 * source listener (the channel itself is owned/closed elsewhere). A `null`
 * channel is a no-op subscription (alerts-over-datachannel unavailable).
 */
export function pushAlertsToChannel(
  channel: DataChannel | null,
  source: AlertChannelSource,
): () => void {
  if (!channel) {
    // Data channels unavailable on this connection: subscribe to nothing.
    return () => {};
  }
  return source.subscribe(event => {
    sendAlertOverChannel(channel, event);
  });
}

/** Sinks the parent drives when a valid alert arrives over the channel. */
export interface AlertChannelReceiverOptions {
  /**
   * Local-notification sink (DMY-46). Defaults to the no-op presenter; the
   * parent screen passes `createNotifeePresenter()`. A throw/rejection here is
   * isolated and never breaks the haptic or the receiver.
   */
  readonly presenter?: AlertNotificationPresenter;
  /**
   * Haptic feedback ({@link HapticFeedback}). Defaults to the no-op; the parent
   * passes `vibrationHaptic`. `trigger()` must never throw.
   */
  readonly haptic?: HapticFeedback;
}

/**
 * Parent-side adapter: subscribe to the data channel and, for every VALID
 * inbound alert, fire the local notification + vibration (DMY-50 AC2).
 *
 * Malformed/unknown messages are dropped by {@link parseAlert} — no
 * notification, no haptic, no throw (AC3). Returns an unsubscribe function that
 * detaches the channel listener.
 *
 * On receipt the parsed `{type,timestamp}` is reconstituted into an
 * {@link AlertEvent} for the presenter (whose content derives from `type`
 * ALONE — privacy). `soundId` is intentionally not carried on the wire; the
 * received event is notification-only (no sound id needed), so it is left empty.
 */
export function receiveAlertsFromChannel(
  channel: DataChannel,
  options: AlertChannelReceiverOptions = {},
): () => void {
  const { presenter = noopNotificationPresenter, haptic = noopHaptic } =
    options;

  return channel.onMessage(payload => {
    const message = parseAlert(payload);
    if (!message) {
      // Malformed/unknown — drop silently (AC3). Coarse log, no payload.
      logger.debug('alert: dropped malformed datachannel message');
      return;
    }
    const event: AlertEvent = {
      type: message.type,
      timestamp: message.timestamp,
      // Not carried over the wire (privacy); the receiver path is notification-
      // only, so no sound id is needed.
      soundId: '',
    };
    // SINK 1: local notification (DMY-46). Isolate a sync throw OR an async
    // rejection so it can never break the haptic or the receiver.
    try {
      const result = presenter.present(event);
      if (result && typeof result.then === 'function') {
        result.then(undefined, () => {
          logger.warn('alert: datachannel notification rejected', {
            type: event.type,
          });
        });
      }
    } catch {
      logger.warn('alert: datachannel notification threw', {
        type: event.type,
      });
    }
    // SINK 2: confirmation vibration. trigger() is contractually no-throw, but
    // wrap defensively so a misbehaving impl cannot break the receiver.
    try {
      haptic.trigger();
    } catch {
      logger.warn('alert: datachannel haptic threw', { type: event.type });
    }
    logger.info('alert: received over datachannel', { type: event.type });
  });
}
