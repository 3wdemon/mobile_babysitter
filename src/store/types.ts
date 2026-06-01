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
 */
export type ConnectionStatus =
  | 'idle'
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
  /** Update the ephemeral connection status. */
  setConnectionStatus: (status: ConnectionStatus) => void;
  /** Reset all state (persisted + ephemeral) back to defaults. */
  reset: () => void;
}

/**
 * Full store shape: persisted + ephemeral state plus actions.
 */
export type AppState = PersistedState & EphemeralState & AppActions;
