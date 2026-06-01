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
 *  - `connecting`   — signalling/ICE in progress (DMY-16/18).
 *  - `connected`    — live P2P media session.
 *  - `disconnected` — a previously-established session dropped.
 */
export type ConnectionStatus =
  | 'idle'
  | 'paired'
  | 'connecting'
  | 'connected'
  | 'disconnected';

/**
 * User-configurable, persisted settings.
 */
export interface Settings {
  /** Theme preference. Stored here; theme resolution lives in the theme layer. */
  theme: ThemePreference;
  /** Whether sound is played for alerts (cry/noise detection). */
  alertSoundsEnabled: boolean;
  /**
   * Whether entering parent monitoring mode requires biometric / PIN unlock
   * (DMY-10). Opt-in: defaults to `false`, so the lock gate is bypassed and the
   * parent screen behaves exactly as before until the user enables it.
   */
  biometricLockEnabled: boolean;
}

/**
 * State that is written to disk via `persist` + `partialize`.
 */
export interface PersistedState {
  role: Role;
  onboardingCompleted: boolean;
  settings: Settings;
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
  /** Enable or disable the biometric/PIN lock on parent mode (DMY-10). */
  setBiometricLockEnabled: (enabled: boolean) => void;
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
