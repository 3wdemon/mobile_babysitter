/**
 * Global app store (DMY-36).
 *
 * Zustand store with the `persist` middleware backed by MMKV. Only the
 * persisted slice (`role`, `onboardingCompleted`, `settings`) is written to
 * disk via `partialize`; ephemeral runtime state (`connectionStatus`) is
 * intentionally excluded so it resets on every launch.
 *
 * Theme integration: `settings.theme` is stored here, but resolving it to a
 * concrete theme stays in the theme layer (`useTheme`, DMY-38). Wiring the two
 * together is deliberately out of scope.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  boundLockoutOnHydration,
  DEFAULT_LOCKOUT_POLICY,
  registerFailure as registerLockoutFailure,
  registerSuccess as registerLockoutSuccess,
} from '../features/auth/lockoutPolicy';
import {
  addUsage,
  EMPTY_QUOTA,
  rolloverForToday,
} from '../features/monetization/freeTierQuota';
import { mmkvStateStorage } from '../services/storage/mmkv';
import { DEFAULT_PERSISTED_STATE, parsePersistedState } from './persistSchema';
import type {
  AppState,
  EphemeralState,
  PersistedState,
  ThemePreference,
} from './types';

/**
 * Key under which the persisted slice is stored in MMKV.
 */
export const APP_STORE_PERSIST_KEY = 'app-store';

/**
 * Default persisted state used on first launch and by `reset`.
 *
 * Sourced from {@link DEFAULT_PERSISTED_STATE} (the single source of truth, also
 * used by the hydration schema's per-field fallbacks) and deep-cloned so the
 * store can never mutate the shared constant. (DMY-43)
 */
const INITIAL_PERSISTED_STATE: PersistedState = {
  ...DEFAULT_PERSISTED_STATE,
  settings: { ...DEFAULT_PERSISTED_STATE.settings },
  freeTierUsage: { ...DEFAULT_PERSISTED_STATE.freeTierUsage },
  pinLockout: { ...DEFAULT_PERSISTED_STATE.pinLockout },
};

/**
 * Default ephemeral state. Recreated on every launch; never persisted.
 */
const INITIAL_EPHEMERAL_STATE: EphemeralState = {
  connectionStatus: 'idle',
  pairedSessionId: null,
};

/**
 * The app store hook.
 *
 * Usage with a selector to avoid unnecessary re-renders:
 * `const role = useAppStore((s) => s.role);`
 */
export const useAppStore = create<AppState>()(
  persist(
    set => ({
      ...INITIAL_PERSISTED_STATE,
      ...INITIAL_EPHEMERAL_STATE,

      setRole: role => set({ role }),
      completeOnboarding: () => set({ onboardingCompleted: true }),
      setTheme: theme =>
        set(state => ({ settings: { ...state.settings, theme } })),
      toggleAlertSounds: () =>
        set(state => ({
          settings: {
            ...state.settings,
            alertSoundsEnabled: !state.settings.alertSoundsEnabled,
          },
        })),
      setNoiseThreshold: threshold =>
        set(state => ({
          settings: {
            ...state.settings,
            // Clamp to [0, 1]; ignore NaN/Infinity by falling back to current.
            noiseThreshold: Number.isFinite(threshold)
              ? Math.min(1, Math.max(0, threshold))
              : state.settings.noiseThreshold,
          },
        })),
      setMotionSensitivity: sensitivity =>
        set(state => ({
          settings: {
            ...state.settings,
            // Clamp to [0, 1]; ignore NaN/Infinity by falling back to current.
            motionSensitivity: Number.isFinite(sensitivity)
              ? Math.min(1, Math.max(0, sensitivity))
              : state.settings.motionSensitivity,
          },
        })),
      setBiometricLockEnabled: enabled =>
        set(state => ({
          settings: { ...state.settings, biometricLockEnabled: enabled },
        })),
      // DMY-12: toggle the baby-unit power-saver posture.
      setPowerSaverEnabled: enabled =>
        set(state => ({
          settings: { ...state.settings, powerSaverEnabled: enabled },
        })),
      // DMY-24: toggle the parent-unit audio-only low-power posture.
      setAudioOnlyEnabled: enabled =>
        set(state => ({
          settings: { ...state.settings, audioOnlyEnabled: enabled },
        })),
      // DMY-56: parent playback volume on a 0..1 scale. 0 mutes output (does NOT
      // disconnect — that is the controller's setVolume contract).
      setPlaybackVolume: volume =>
        set(state => ({
          settings: {
            ...state.settings,
            // Clamp to [0, 1]; ignore NaN/Infinity by falling back to current.
            playbackVolume: Number.isFinite(volume)
              ? Math.min(1, Math.max(0, volume))
              : state.settings.playbackVolume,
          },
        })),
      // DMY-11: PLACEHOLDER premium flag. No StoreKit/purchase behind it yet
      // (DMY-27); flips only via this action so the quota wiring is testable.
      setPremium: isPremium =>
        set(state => ({
          settings: { ...state.settings, isPremium },
        })),
      // DMY-11: accumulate consumed free-tier time. Premium users have no cap,
      // so we never touch the counter for them. The pure core handles local-day
      // rollover and ignores non-finite / non-positive deltas.
      addFreeTierUsage: deltaMs =>
        set(state => {
          if (state.settings.isPremium) {
            return {};
          }
          return {
            freeTierUsage: addUsage(state.freeTierUsage, deltaMs, Date.now()),
          };
        }),
      resetFreeTierUsage: () =>
        set(() => ({
          // Re-stamp to today's local day with a zero counter.
          freeTierUsage: rolloverForToday({ ...EMPTY_QUOTA }, Date.now()),
        })),
      // DMY-44: parent-mode PIN rate-limit. The timing logic is the pure,
      // clock-injected `lockoutPolicy`; the store just persists the result so the
      // attempt budget survives a relaunch.
      registerPinFailure: nowMs =>
        set(state => ({
          pinLockout: registerLockoutFailure(
            state.pinLockout,
            DEFAULT_LOCKOUT_POLICY,
            nowMs,
          ),
        })),
      resetPinLockout: () => set(() => ({ pinLockout: registerLockoutSuccess() })),
      setConnectionStatus: connectionStatus => set({ connectionStatus }),
      // Pairing succeeded (QR scanned + validated). We record the session id and
      // mark `paired`, but the WebRTC handshake is NOT started here — signalling
      // is DMY-16/18. Deliberately not faking `connected`.
      setPaired: sessionId =>
        set({ pairedSessionId: sessionId, connectionStatus: 'paired' }),
      clearPairing: () =>
        set({ pairedSessionId: null, connectionStatus: 'idle' }),
      reset: () =>
        set({ ...INITIAL_PERSISTED_STATE, ...INITIAL_EPHEMERAL_STATE }),
    }),
    {
      name: APP_STORE_PERSIST_KEY,
      storage: createJSONStorage(() => mmkvStateStorage),
      // Persist ONLY the durable slice; ephemeral fields are excluded so
      // runtime state (e.g. connectionStatus) never reaches disk.
      partialize: (state): PersistedState => ({
        role: state.role,
        onboardingCompleted: state.onboardingCompleted,
        settings: state.settings,
        // Persist the free-tier counter so the 1h/day cap is not bypassed by a
        // relaunch within the same local day (DMY-11). The stored `dateKey`
        // makes a previous day's usage self-expiring on rollover.
        freeTierUsage: state.freeTierUsage,
        // Persist the PIN lockout so a wrong-attempt budget / active cooldown is
        // not reset by relaunching mid-lockout (DMY-44).
        pinLockout: state.pinLockout,
      }),
      // Hardened merge (DMY-43). The default zustand merge is SHALLOW and trusts
      // the on-disk blob verbatim, so a stale/partial/corrupt value could either
      // drop newly-added fields (leaving `undefined` holes) or smuggle an
      // out-of-range / wrong-typed value (e.g. `role: 12345`, `theme: "neon"`)
      // straight into runtime state. We delegate to `parsePersistedState`, which
      // validates the untrusted blob against a Zod schema, repairs/drops invalid
      // fields, and DEEP-merges the survivors over the current defaults. The
      // result is always a complete, valid persisted slice — a corrupt blob can
      // never crash hydration. Ephemeral fields come from `current` (they are
      // never persisted), and the live action functions are preserved.
      merge: (persisted, current) => {
        const validated = parsePersistedState(
          persisted,
          INITIAL_PERSISTED_STATE,
        );
        // DMY-44 security: bound a tampered/bit-rotted `lockedUntil` ONCE here,
        // where the wall clock is available (the schema is intentionally
        // clock-free). A corrupt finite far-future deadline would otherwise make
        // the gate report locked forever — an unrecoverable lockout. Clamping to
        // `now + maxCooldownMs` (the max any legitimate lock can be) lets a stuck
        // lock self-heal within one cooldown window instead of never.
        const pinLockout = boundLockoutOnHydration(
          validated.pinLockout,
          DEFAULT_LOCKOUT_POLICY,
          Date.now(),
        );
        return {
          ...current,
          ...validated,
          pinLockout,
        };
      },
    },
  ),
);

/**
 * Selector for the persisted theme preference (DMY-70).
 *
 * This is the single seam that feeds `useTheme()` its default mode, so the
 * preference chosen in Settings (`setTheme`) propagates to every non-hardcoded
 * screen. Exposed as a dedicated selector (rather than an inline
 * `useAppStore(s => s.settings.theme)`) so consumers subscribe to ONLY the
 * theme slice and re-render solely when it changes.
 */
export const useThemePreference = (): ThemePreference =>
  useAppStore(s => s.settings.theme);
