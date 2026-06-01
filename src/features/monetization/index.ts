/**
 * Public surface of the monetization feature (DMY-11).
 *
 * Honest free tier: 1 hour of total monitoring per local day, resetting at
 * local midnight. Premium removes the cap. NOTE: there is NO real purchase /
 * StoreKit here — `settings.isPremium` is a placeholder flag wired ahead of the
 * actual purchase flow (DMY-27, blocked-external).
 */
export {
  FREE_TIER_DAILY_LIMIT_MS,
  EMPTY_QUOTA,
  localDateKey,
  rolloverForToday,
  addUsage,
  remainingMs,
  isExhausted,
} from './freeTierQuota';
export type { QuotaState, Clock } from './freeTierQuota';
export {
  useFreeTierSession,
  DEFAULT_TICK_MS,
} from './useFreeTierSession';
export type {
  UseFreeTierSessionOptions,
  FreeTierSessionState,
} from './useFreeTierSession';
export { default as FreeTierLimitBanner } from './FreeTierLimitBanner';
export type { FreeTierLimitBannerProps } from './FreeTierLimitBanner';
