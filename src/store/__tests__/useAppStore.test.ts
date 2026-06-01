import { act, renderHook } from '@testing-library/react-native';
import { createMMKV } from 'react-native-mmkv';

import type { AppState, PersistedState } from '../types';
import { useAppStore } from '../useAppStore';

// `__resetAllMmkv` is a test-only helper on the in-memory mock (see
// `__mocks__/react-native-mmkv.ts`); it is not part of the real module's types.
const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

/**
 * Read and parse the raw persisted blob straight from the (mocked) MMKV store,
 * bypassing zustand. Used to assert exactly what `partialize` wrote to disk.
 */
function readPersistedBlob(): {
  state: Record<string, unknown>;
  version?: number;
} | null {
  const raw = createMMKV({ id: 'mobile-babysitter-app' }).getString(
    'app-store',
  );
  return raw ? JSON.parse(raw) : null;
}

describe('useAppStore', () => {
  beforeEach(() => {
    __resetAllMmkv();
    // Reset the live store to defaults between tests (it is a module singleton).
    act(() => {
      useAppStore.getState().reset();
    });
  });

  it('has the expected default state on first launch', () => {
    const state = useAppStore.getState();
    expect(state.role).toBeNull();
    expect(state.onboardingCompleted).toBe(false);
    expect(state.settings).toEqual({
      theme: 'system',
      alertSoundsEnabled: true,
    });
    expect(state.connectionStatus).toBe('idle');
  });

  it('updates state via actions', () => {
    act(() => {
      useAppStore.getState().setTheme('dark');
      useAppStore.getState().toggleAlertSounds();
      useAppStore.getState().setRole('parent');
      useAppStore.getState().completeOnboarding();
      useAppStore.getState().setConnectionStatus('connecting');
    });
    const state = useAppStore.getState();
    expect(state.settings.theme).toBe('dark');
    expect(state.settings.alertSoundsEnabled).toBe(false);
    expect(state.role).toBe('parent');
    expect(state.onboardingCompleted).toBe(true);
    expect(state.connectionStatus).toBe('connecting');
  });

  it('reset restores defaults', () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setTheme('light');
      useAppStore.getState().setConnectionStatus('connected');
      useAppStore.getState().reset();
    });
    const state = useAppStore.getState();
    expect(state.role).toBeNull();
    expect(state.settings.theme).toBe('system');
    expect(state.connectionStatus).toBe('idle');
  });

  describe('persistence', () => {
    it('persists a settings change and restores it after a simulated restart', () => {
      act(() => {
        useAppStore.getState().setTheme('dark');
        useAppStore.getState().setRole('parent');
        useAppStore.getState().completeOnboarding();
      });

      // Simulate an app restart: re-evaluate the store module in an isolated
      // registry. The MMKV mock keeps its backing data on globalThis, so the
      // fresh store rehydrates from the previously persisted blob.
      let restored: AppState | undefined;
      jest.isolateModules(() => {
        const freshStore = require('../useAppStore')
          .useAppStore as typeof useAppStore;
        restored = freshStore.getState();
      });

      expect(restored?.settings.theme).toBe('dark');
      expect(restored?.role).toBe('parent');
      expect(restored?.onboardingCompleted).toBe(true);
    });

    it('partialize persists ONLY role/onboardingCompleted/settings, never ephemeral fields', () => {
      act(() => {
        useAppStore.getState().setRole('baby');
        useAppStore.getState().setConnectionStatus('connected');
      });

      const blob = readPersistedBlob();
      expect(blob).not.toBeNull();
      const persisted = blob!.state as Partial<PersistedState> &
        Record<string, unknown>;

      expect(Object.keys(persisted).sort()).toEqual([
        'onboardingCompleted',
        'role',
        'settings',
      ]);
      expect(persisted).not.toHaveProperty('connectionStatus');
      expect(persisted.role).toBe('baby');
    });

    it('does not restore the ephemeral connectionStatus across a restart', () => {
      act(() => {
        useAppStore.getState().setConnectionStatus('connected');
      });

      let restored: AppState | undefined;
      jest.isolateModules(() => {
        const freshStore = require('../useAppStore')
          .useAppStore as typeof useAppStore;
        restored = freshStore.getState();
      });

      // Must fall back to the initial ephemeral default, not the prior value.
      expect(restored?.connectionStatus).toBe('idle');
    });
  });

  describe('selectors', () => {
    it('does not re-render a subscriber when an unrelated field changes', () => {
      let roleRenders = 0;
      renderHook(() => {
        roleRenders += 1;
        return useAppStore(s => s.role);
      });

      const baseline = roleRenders;

      // Change an unrelated field: the role selector must not re-render.
      act(() => {
        useAppStore.getState().setTheme('dark');
      });
      expect(roleRenders).toBe(baseline);

      // Change the selected field: now it re-renders.
      act(() => {
        useAppStore.getState().setRole('parent');
      });
      expect(roleRenders).toBe(baseline + 1);
    });
  });
});
