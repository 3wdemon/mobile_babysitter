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
  },
};

/**
 * Default ephemeral state. Recreated on every launch; never persisted.
 */
const INITIAL_EPHEMERAL_STATE: EphemeralState = {
  connectionStatus: 'idle',
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
      setConnectionStatus: connectionStatus => set({ connectionStatus }),
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
      }),
    },
  ),
);
