/**
 * Local-notification sink for raised alerts (DMY-46) — a $0, on-device,
 * server-free alternative to push (DMY-9 APNS/FCM).
 *
 * The {@link AlertService} already turns a privacy-safe detection event into a
 * raised {@link AlertEvent} and plays a per-type SOUND through an injected
 * {@link AlertSoundPlayer}. This module adds a SECOND sink, IN PARALLEL to the
 * sound: a local notification, posted with `@notifee/react-native`. It does NOT
 * touch policy — throttle / priority / snooze all live in the service, and the
 * presenter is invoked by `useAlerts` ONLY for events the service actually
 * raised (never for dropped/snoozed/throttled ones).
 *
 * ## Seam (mirrors AlertSoundPlayer / network / battery)
 * Consumers depend ONLY on {@link AlertNotificationPresenter}; the concrete
 * notifee adapter is selected lazily behind a `require()` guard
 * ({@link createNotifeePresenter}) so importing this module under Jest / bare JS
 * does not pull the native side. The SHIPPED default is
 * {@link noopNotificationPresenter} — a safe no-op that satisfies the contract,
 * never throws and presents nothing — so the feature is wired and tested without
 * faking real OS notifications.
 *
 * ## Privacy (type-only)
 * A notification's title/body are derived from the alert TYPE ALONE
 * (cry / motion / noise / no_motion), via the i18n `alerts.notification.*`
 * catalog. NO audio sample, video frame, raw detection metric, loudness/motion
 * scalar, timestamp or soundId ever reaches the OS notification surface — only
 * the discriminant type chooses a fixed, translated string. This is the same
 * boundary the rest of the alert layer keeps: the parent learns WHAT happened,
 * never the raw content.
 *
 * ## Failure isolation
 * Every notifee call is wrapped (in the spirit of `createSafeAudioPlayback`) so
 * a missing channel, a denied permission or a native throw can NEVER break the
 * alert pipeline or the parallel sound. A failure degrades to a logged warning.
 */
import { logger } from '../../services/logger';
import { t } from '../../services/i18n';
import type { AlertEvent, AlertType } from './alertTypes';

/**
 * The notification sink seam. `present` is called by `useAlerts` for each RAISED
 * alert, in parallel to the sound. Implementations must NEVER throw from these
 * methods (failures are swallowed/logged); `present` may be sync or async.
 */
export interface AlertNotificationPresenter {
  /**
   * Post a local notification for a raised {@link AlertEvent}. Implementations
   * derive the title/body from the event TYPE ONLY (privacy). Returns void or a
   * promise that resolves once posting is attempted; a rejection must not
   * propagate to the caller.
   */
  present(event: AlertEvent): void | Promise<void>;
  /**
   * Cancel any notifications this presenter has posted (e.g. when a monitoring
   * session tears down). Optional; the noop omits it.
   */
  cancelAll?(): void | Promise<void>;
}

/**
 * Android notification channel id for monitor alerts. Stable so the channel is
 * created idempotently and re-used across posts.
 */
export const ALERT_CHANNEL_ID = 'baby-monitor-alerts';

/**
 * Resolve the type-only title/body for an alert. Uses ONLY `event.type` to pick
 * a fixed translated string from the `alerts.notification.<type>` catalog —
 * never the timestamp, soundId, or any metric/media. Exported for unit testing
 * the privacy boundary directly.
 */
export function notificationContentForType(type: AlertType): {
  title: string;
  body: string;
} {
  return {
    title: t(`alerts.notification.${type}.title`),
    body: t(`alerts.notification.${type}.body`),
  };
}

/**
 * Safe no-op {@link AlertNotificationPresenter}: records intent in the log
 * (privacy-safe — only the alert type, never media) but posts nothing. Stateless,
 * total, the SHIPPED default until the native notifee module is linked.
 */
export const noopNotificationPresenter: AlertNotificationPresenter = {
  present(event: AlertEvent): void {
    // Log only the type — never any metric/audio/frame. Makes the no-op
    // observable in dev without leaking content.
    logger.debug('alert: notify (no-op)', { type: event.type });
  },
};

/**
 * Factory for the no-op presenter. Returns the shared stateless instance;
 * exposed as a function so call sites read symmetrically with
 * {@link createNotifeePresenter}.
 */
export function createNoopNotificationPresenter(): AlertNotificationPresenter {
  return noopNotificationPresenter;
}

/**
 * Minimal shape of the `@notifee/react-native` surface we consume. The library
 * exposes far more; we touch only channel creation + display + cancel and treat
 * the rest as opaque so a version bump can't break us.
 *
 * `createChannel` is Android-only in effect (a no-op on iOS) but safe to call on
 * both; we always pass the channel id to `displayNotification` and let notifee
 * ignore it on iOS.
 */
export interface NotifeeLike {
  createChannel: (channel: {
    id: string;
    name: string;
    description?: string;
  }) => Promise<string> | string;
  displayNotification: (notification: {
    title?: string;
    body?: string;
    android?: { channelId: string };
  }) => Promise<string> | string;
  cancelAllNotifications?: () => Promise<void> | void;
}

/**
 * Build a presenter backed by a notifee-like module. Exported (separately from
 * the factory) so unit tests can drive the mapping/channel/display wiring with a
 * fake module WITHOUT touching the native bridge.
 *
 * The Android channel is created idempotently (notifee de-dupes by id) on the
 * first `present` and cached so subsequent posts skip the round-trip. Every
 * notifee call is wrapped so a throw/rejection degrades to a logged warning and
 * never escapes — the alert pipeline and the parallel sound are unaffected.
 */
export function createPresenterFromNotifee(
  notifee: NotifeeLike,
): AlertNotificationPresenter {
  // Whether the channel has been (attempted to be) created this process. Cached
  // so we don't issue a createChannel on every alert.
  let channelReady = false;

  const ensureChannel = async (): Promise<void> => {
    if (channelReady) {
      return;
    }
    // Mark ready up front so a slow/failed creation does not cause repeated
    // attempts to pile up; notifee.createChannel is itself idempotent by id.
    channelReady = true;
    await notifee.createChannel({
      id: ALERT_CHANNEL_ID,
      name: t('alerts.notification.channelName'),
      description: t('alerts.notification.channelDescription'),
    });
  };

  return {
    present: async (event: AlertEvent): Promise<void> => {
      try {
        await ensureChannel();
        // PRIVACY: title/body come from the TYPE ALONE — no metric/audio/frame.
        const { title, body } = notificationContentForType(event.type);
        await notifee.displayNotification({
          title,
          body,
          android: { channelId: ALERT_CHANNEL_ID },
        });
        // Log only the type — never the content.
        logger.info('alert: notification presented', { type: event.type });
      } catch {
        // A failure here must never break the alert pipeline or the parallel
        // sound. Allow the channel to be retried on the next event.
        channelReady = false;
        logger.warn('alert: notifee present failed', { type: event.type });
      }
    },
    cancelAll: async (): Promise<void> => {
      try {
        await notifee.cancelAllNotifications?.();
      } catch {
        logger.warn('alert: notifee cancelAll failed');
      }
    },
  };
}

/**
 * Default factory: the real notifee-backed presenter if the native module is
 * present, else the no-op. Picking happens lazily here (not at import) so
 * importing this module under Jest does not pull the native side.
 *
 * NOTE: the require/adapter branch is not exercised by the unit suite (it would
 * touch the native module); the unit tests drive {@link createPresenterFromNotifee}
 * with a fake module and assert the noop fallback directly.
 */
export function createNotifeePresenter(): AlertNotificationPresenter {
  try {
    // Required lazily and through require() to keep the native module out of the
    // type graph and out of Jest's module load.
    const notifee = require('@notifee/react-native').default;
    if (
      !notifee ||
      typeof notifee.createChannel !== 'function' ||
      typeof notifee.displayNotification !== 'function'
    ) {
      logger.warn('alert: notifee module malformed — using no-op presenter');
      return noopNotificationPresenter;
    }
    return createPresenterFromNotifee(notifee as NotifeeLike);
  } catch {
    logger.warn('alert: notifee unavailable — using no-op presenter');
    return noopNotificationPresenter;
  }
}
