/**
 * Public surface of the smart-alerts feature (DMY-26).
 *
 * Turns privacy-safe detection events (cry / motion / no_motion / noise) into
 * parent-unit alerts that play a DISTINCT sound per event type. Real sound-asset
 * playback is abstracted behind {@link AlertSoundPlayer}; the shipped default is
 * a no-op (real playback is the audio integration point — DMY-9).
 *
 * Privacy-first: nothing here carries audio, frames, detection metrics or any
 * media — only an alert type, timestamp and sound id.
 */
export { AlertService, createAlertService } from './alertService';
export type {
  AlertServiceOptions,
  AlertResult,
  AlertDropReason,
  Clock,
} from './alertService';

export {
  SOUND_BY_ALERT_TYPE,
  soundIdForType,
  configForType,
} from './alertSoundMap';

export {
  noopAlertSoundPlayer,
  createNoopAlertSoundPlayer,
} from './alertSoundPlayer';

export {
  noopNotificationPresenter,
  createNoopNotificationPresenter,
  createNotifeePresenter,
  createPresenterFromNotifee,
  notificationContentForType,
  ALERT_CHANNEL_ID,
} from './notificationPresenter';
export type {
  AlertNotificationPresenter,
  NotifeeLike,
} from './notificationPresenter';

export { useAlerts } from './useAlerts';
export type {
  AlertEventSource,
  AlertsState,
  UseAlertsOptions,
} from './useAlerts';

export { useSnooze, SNOOZE_DURATION_MS } from './useSnooze';
export type { SnoozeState, UseSnoozeOptions } from './useSnooze';

export {
  noopHaptic,
  vibrationHaptic,
  SNOOZE_HAPTIC_MS,
} from './hapticFeedback';
export type { HapticFeedback } from './hapticFeedback';

export {
  ALERT_CHANNEL_LABEL,
  serializeAlert,
  parseAlert,
  sendAlertOverChannel,
  receiveAlertsFromChannel,
  pushAlertsToChannel,
} from './alertChannel';
export type {
  AlertChannelMessage,
  AlertChannelReceiverOptions,
  AlertChannelSource,
} from './alertChannel';

export { default as LastAlertIndicator } from './LastAlertIndicator';
export type { LastAlertIndicatorProps } from './LastAlertIndicator';

export type {
  AlertEvent,
  AlertSoundPlayer,
  AlertType,
  AlertTypeConfig,
  SoundId,
} from './alertTypes';
