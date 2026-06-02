/**
 * Type definitions for the global app store (DMY-36).
 *
 * The store is split into three conceptual groups:
 *  - **persisted** state (`role`, `onboardingCompleted`, `settings`) — survives
 *    app restarts via the MMKV-backed `persist` middleware,
 *  - **ephemeral** state (e.g. `connectionStatus`) — runtime-only, never
 *    written to disk (excluded by `partialize`),
 *  - **actions** — synchronous state mutators.
 */

/**
 * Device role within a pairing session.
 *  - `'baby'`   — this device streams audio/video (the monitor).
 *  - `'parent'` — this device receives the stream (the viewer).
 *  - `null`     — role not yet chosen.
 */
export type Role = 'baby' | 'parent' | null;

/**
 * Theme preference. `'system'` follows the OS color scheme.
 *
 * Mirrors `ThemeMode` from the theme layer (DMY-38); kept as a local literal
 * union so the store does not depend on the theme module. Store-driven theme
 * integration is intentionally out of scope for DMY-36.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * Ephemeral connection status. Runtime-only; not persisted.
 *
 *  - `idle`         — nothing in progress.
 *  - `paired`       — the parent-unit has scanned and validated a baby-unit QR
 *    and recorded its `sessionId`, but the real WebRTC signalling handshake has
 *    NOT happened yet. This is an HONEST intermediate state: pairing succeeded,
 *    the media connection does not exist. The signalling exchange (offer/answer,
 *    ICE) lands in DMY-16/18 and will drive the status onward to
 *    `connecting` -> `connected`. We deliberately do NOT fake `connected` on a
 *    successful scan. (DMY-14)
 *  - `connecting`   — signalling/ICE in progress (DMY-16): the SDP offer/answer
 *    exchange and ICE negotiation are underway but the peer connection has not
 *    reached `connected` yet. Driven by real `RTCPeerConnection` connection-state
 *    events, not faked.
 *  - `connected`    — live P2P media session (peer connection reached the
 *    `connected` connection-state).
 *  - `disconnected` — a previously-established session dropped (peer connection
 *    transitioned to `disconnected`/`closed`).
 *  - `failed`       — signalling/ICE negotiation failed (peer connection reached
 *    the `failed` connection-state, or signalling errored). Distinct from
 *    `disconnected`: nothing was ever established. Surfaced from real
 *    `RTCPeerConnection` events (DMY-16), never faked.
 */
export type ConnectionStatus =
  | 'idle'
  | 'paired'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

/**
 * User-configurable, persisted settings.
 */
export interface Settings {
  /** Theme preference. Stored here; theme resolution lives in the theme layer. */
  theme: ThemePreference;
  /** Whether sound is played for alerts (cry/noise detection). */
  alertSoundsEnabled: boolean;
  /**
   * Noise-detection sensitivity as the loudness enter-threshold on a normalised
   * 0..1 scale (DMY-8). Higher = less sensitive (a louder sound is required to
   * trigger a noise event). Only this scalar is persisted; no audio is stored.
   */
  noiseThreshold: number;
  /**
   * Motion-detection sensitivity as the motion enter-threshold on a normalised
   * 0..1 scale (DMY-25). LOWER = more sensitive (less inter-frame change is
   * required to count as motion / to break stillness). Only this scalar is
   * persisted; no frame/video is ever stored. Maps onto the motion detector's
   * `enterThreshold`; the >30s no-motion timer is fixed in the detector config.
   */
  motionSensitivity: number;
  /**
   * Whether entering parent monitoring mode requires biometric / PIN unlock
   * (DMY-10). Opt-in: defaults to `false`, so the lock gate is bypassed and the
   * parent screen behaves exactly as before until the user enables it.
   */
  biometricLockEnabled: boolean;
  /**
   * Whether the user has the premium entitlement (DMY-11). When `true` the
   * free-tier daily session cap (1h) does not apply. Defaults to `false`.
   *
   * IMPORTANT: this is a PLACEHOLDER flag only. There is NO real purchase /
   * StoreKit / entitlement-verification behind it yet — that is DMY-27
   * (blocked-external). For now it can only flip via the dev/test-facing
   * `setPremium` action; nothing in the shipping UI grants it. The free-tier
   * quota logic reads it so wiring is ready the moment DMY-27 lands.
   */
  isPremium: boolean;
  /**
   * Whether the baby-unit enters power-saver mode during an active monitoring
   * session (DMY-12): dim the screen, keep it awake-but-dark, and disable
   * non-essential sensors to cut battery/heat over long overnight sessions.
   *
   * Defaults to `true`: the product-spec lists dim-screen + sensor-off as the
   * EXPECTED baby-unit posture, and a near-black nursery screen is the safer,
   * lower-power default for an unattended monitor on a charger. The user can
   * opt OUT via the baby-screen toggle (e.g. to use the screen as a nightlight).
   */
  powerSaverEnabled: boolean;
  /**
   * Whether the parent-unit runs in audio-only low-power mode (DMY-24). When
   * `true` the parent does NOT request the remote video track — only audio is
   * received — to cut bandwidth, battery and data on long overnight sessions;
   * the user can momentarily peek at video on demand (a tap), which does not
   * change this persisted preference.
   *
   * Defaults to `true`: audio-only is the lower-power, lower-bandwidth baseline
   * and matches how a traditional baby monitor is used (listen continuously,
   * glance at the picture occasionally). The product-spec frames the parent
   * side as battery- and data-conscious, so we default to the cheaper posture
   * and let the user opt INTO always-on video.
   */
  audioOnlyEnabled: boolean;
}

/**
 * Free-tier daily usage accounting (DMY-11).
 *
 * Tracks how much monitoring time has been consumed during the CURRENT local
 * calendar day. Persisted so the cap survives an app restart within the same
 * day; reset to zero on the first interaction of a new local day (midnight in
 * the device's local time — see `freeTierQuota`). Holds no personal data, just
 * a millisecond counter and an opaque local date-key.
 */
export interface FreeTierUsage {
  /** Milliseconds of monitoring consumed so far during `dateKey`. */
  usedMs: number;
  /**
   * The local calendar day this counter belongs to, as a `YYYY-MM-DD` key in
   * the device's local time. When the current local day no longer matches this
   * key, `usedMs` is treated as stale and reset to 0 (daily rollover at local
   * midnight). `null` before any usage has been recorded.
   */
  dateKey: string | null;
}

/**
 * State that is written to disk via `persist` + `partialize`.
 */
export interface PersistedState {
  role: Role;
  onboardingCompleted: boolean;
  settings: Settings;
  /**
   * Free-tier daily usage counter (DMY-11). Persisted so the 1h/day cap is not
   * trivially reset by relaunching the app within the same local day.
   */
  freeTierUsage: FreeTierUsage;
}

/**
 * Runtime-only state that must never be persisted.
 */
export interface EphemeralState {
  /** Current P2P connection status. Reset on every launch. */
  connectionStatus: ConnectionStatus;
  /**
   * The `sessionId` of the baby-unit this device paired with after scanning its
   * QR (DMY-14), or `null` when not paired. Ephemeral and NOT persisted: a
   * pairing session must not outlive the app process (privacy — the id is a
   * single-use, per-session value). Carries no personal data.
   */
  pairedSessionId: string | null;
}

/**
 * Synchronous state mutators.
 */
export interface AppActions {
  /** Set (or clear, with `null`) the device role. */
  setRole: (role: Role) => void;
  /** Mark onboarding as completed. */
  completeOnboarding: () => void;
  /** Update the theme preference. */
  setTheme: (theme: ThemePreference) => void;
  /** Toggle alert sounds on/off. */
  toggleAlertSounds: () => void;
  /**
   * Set the noise-detection sensitivity (enter-threshold, 0..1) (DMY-8).
   * Out-of-range or non-finite values are clamped to [0, 1].
   */
  setNoiseThreshold: (threshold: number) => void;
  /**
   * Set the motion-detection sensitivity (enter-threshold, 0..1) (DMY-25).
   * Out-of-range or non-finite values are clamped to [0, 1].
   */
  setMotionSensitivity: (sensitivity: number) => void;
  /** Enable or disable the biometric/PIN lock on parent mode (DMY-10). */
  setBiometricLockEnabled: (enabled: boolean) => void;
  /** Enable or disable baby-unit power-saver mode (DMY-12). */
  setPowerSaverEnabled: (enabled: boolean) => void;
  /** Enable or disable parent-unit audio-only low-power mode (DMY-24). */
  setAudioOnlyEnabled: (enabled: boolean) => void;
  /**
   * Set the premium entitlement flag (DMY-11). PLACEHOLDER only — there is no
   * real purchase behind it (StoreKit is DMY-27). Exposed so tests and a future
   * purchase flow can flip it; not wired to any shipping CTA.
   */
  setPremium: (isPremium: boolean) => void;
  /**
   * Record `deltaMs` of consumed free-tier monitoring time (DMY-11), rolling
   * the counter over to 0 first if the current local day differs from the
   * stored `dateKey` (local-midnight reset). Non-finite or non-positive deltas
   * are ignored. No-op when the user is premium.
   */
  addFreeTierUsage: (deltaMs: number) => void;
  /** Reset the free-tier daily usage counter to zero for the current day. */
  resetFreeTierUsage: () => void;
  /** Update the ephemeral connection status. */
  setConnectionStatus: (status: ConnectionStatus) => void;
  /**
   * Record a successful QR pairing (DMY-14): store the baby-unit `sessionId`
   * and move `connectionStatus` to `paired`. Does NOT start signalling — that
   * is DMY-16/18.
   */
  setPaired: (sessionId: string) => void;
  /**
   * Clear the pairing: forget the session id and return `connectionStatus` to
   * `idle`. Used to scan again / leave the paired screen.
   */
  clearPairing: () => void;
  /** Reset all state (persisted + ephemeral) back to defaults. */
  reset: () => void;
}

/**
 * Full store shape: persisted + ephemeral state plus actions.
 */
export type AppState = PersistedState & EphemeralState & AppActions;
