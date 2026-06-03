/**
 * freeMode — MVP "everything is free" switch (DMY-51).
 *
 * `FREE_MODE` is the SINGLE SOURCE OF TRUTH for the launch monetization stance:
 * for the MVP every feature is free, the honest free-tier daily cap (DMY-11) is
 * NOT enforced, and no paywall / upgrade UI is surfaced. Settings instead shows
 * a passive "Support development — coming soon" placeholder (no purchase flow).
 *
 * WHY a separate flag instead of `settings.isPremium = true`:
 * Setting `isPremium` would corrupt the "user has purchased" semantics and break
 * the DMY-11 cap logic/tests that depend on it. `FREE_MODE` is layered ON TOP of
 * the existing cap: the cap only applies when `!isPremium && !FREE_MODE`. With
 * `FREE_MODE` on, the cap is bypassed without ever touching `isPremium`, so the
 * underlying DMY-11 behaviour is preserved byte-for-byte and simply gated off.
 *
 * HOW TO REVERT (when DMY-27 — real in-app purchases — lands):
 *   1. Set `FREE_MODE = false` below. That re-enables the DMY-11 daily cap for
 *      non-premium users EXACTLY as it shipped (interval accrual, exhausted
 *      state, `onLimitReached`, and the {@link FreeTierLimitBanner}).
 *   2. Replace the Settings "Support development — coming soon" placeholder with
 *      the real purchase entry point (DMY-27).
 *   3. Wire the banner's upgrade CTA to the real purchase flow.
 * No other code change is required to restore the cap — this flag is the only
 * switch. Keep it a plain boolean constant (not store/remote state) so it is
 * statically auditable and trivially flipped for the DMY-27 cutover.
 */

/**
 * When `true` (MVP default), the free-tier daily cap and all paywall UI are
 * disabled and every feature is free. Flip to `false` when DMY-27 ships real
 * purchases to restore the DMY-11 cap behaviour.
 */
export const FREE_MODE = true;
