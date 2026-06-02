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
  addUsage,
  EMPTY_QUOTA,
  rolloverForToday,
} from '../features/monetization/freeTierQuota';
import { mmkvStateStorage } from '../services/storage/mmkv';
import type { AppState, EphemeralState, PersistedState } from './types';

/**
 * Key under which the persisted slice is stored in MMKV.
 */
export const APP_STORE_PERSIST_KEY = 'app-store';

/**
 * Default persisted state used on first launch and by `reset`.
 */
const INITIAL_PERSISTED_STATE: PersistedState = {
  role: null,
  onboardingCompleted: false,
  settings: {
    theme: 'system',
    alertSoundsEnabled: true,
    // Default noise sensitivity (enter-threshold on the 0..1 loudness scale).
    // Mirrors DEFAULT_NOISE_CONFIG.enterThreshold in features/detection; kept as
    // a literal so the store does not depend on the feature module. (DMY-8)
    noiseThreshold: 0.6,
    // Default motion sensitivity (enter-threshold on the 0..1 motion scale).
    // Mirrors DEFAULT_MOTION_CONFIG.enterThreshold in features/detection; kept
    // as a literal so the store does not depend on the feature module. (DMY-25)
    motionSensitivity: 0.15,
    // Opt-in: parent mode is unlocked by default until the user turns this on.
    biometricLockEnabled: false,
    // Free by default. PLACEHOLDER — no real purchase grants this yet (DMY-27).
    isPremium: false,
    // On by default (DMY-12): dim-screen + sensors-off is the expected, safer,
    // lower-power baby-unit posture per product-spec. User can opt out.
    powerSaverEnabled: true,
    // On by default (DMY-24): audio-only is the lower-power, lower-bandwidth
    // parent posture (listen continuously, peek at video on demand). User can
    // opt INTO always-on video.
    audioOnlyEnabled: true,
  },
  // Free-tier daily usage starts empty; rolls over at local midnight. (DMY-11)
  freeTierUsage: { ...EMPTY_QUOTA },
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
      }),
      // Defensive merge (DMY-11, mindful of the DMY-43 persist-gap): the default
      // zustand merge is SHALLOW, so a blob written before these fields existed
      // would replace `settings` wholesale (dropping the new `isPremium`
      // default) and would carry NO `freeTierUsage` at all. We deep-merge
      // `settings` over the defaults and backfill `freeTierUsage` so an older
      // on-disk shape rehydrates into a complete, valid state instead of leaving
      // `undefined` holes. We do NOT attempt forward-migration beyond this.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<PersistedState>;
        return {
          ...current,
          ...saved,
          settings: {
            ...current.settings,
            ...(saved.settings ?? {}),
          },
          freeTierUsage: saved.freeTierUsage ?? current.freeTierUsage,
        };
      },
    },
  ),
);
