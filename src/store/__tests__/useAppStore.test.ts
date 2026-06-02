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

/**
 * Seed a raw value directly into the (mocked) MMKV store under the persist key,
 * bypassing zustand. Used to simulate pre-existing / malformed on-disk blobs.
 */
function seedPersistedRaw(raw: string): void {
  createMMKV({ id: 'mobile-babysitter-app' }).set('app-store', raw);
}

/**
 * Re-evaluate the store module in an isolated registry (simulated app restart)
 * and return the rehydrated state. The MMKV mock keeps its backing data on
 * globalThis, so the fresh store rehydrates from whatever is on disk.
 */
function restartAndGetState(): AppState {
  let restored: AppState | undefined;
  jest.isolateModules(() => {
    const freshStore = require('../useAppStore')
      .useAppStore as typeof useAppStore;
    restored = freshStore.getState();
  });
  if (!restored) {
    throw new Error('store failed to initialise after simulated restart');
  }
  return restored;
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
      noiseThreshold: 0.6,
      motionSensitivity: 0.15,
      biometricLockEnabled: false,
      isPremium: false,
      powerSaverEnabled: true,
      audioOnlyEnabled: true,
    });
    expect(state.connectionStatus).toBe('idle');
    expect(state.pairedSessionId).toBeNull();
  });

  describe('pairing actions (DMY-14)', () => {
    it('setPaired records the session id and moves to "paired" (not connected)', () => {
      act(() => {
        useAppStore
          .getState()
          .setPaired('11111111-1111-4111-8111-111111111111');
      });
      const state = useAppStore.getState();
      expect(state.pairedSessionId).toBe(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(state.connectionStatus).toBe('paired');
      // Honest: pairing != a live media connection.
      expect(state.connectionStatus).not.toBe('connected');
    });

    it('clearPairing forgets the session and returns to idle', () => {
      act(() => {
        useAppStore
          .getState()
          .setPaired('22222222-2222-4222-8222-222222222222');
        useAppStore.getState().clearPairing();
      });
      const state = useAppStore.getState();
      expect(state.pairedSessionId).toBeNull();
      expect(state.connectionStatus).toBe('idle');
    });

    it('reset clears the pairing session', () => {
      act(() => {
        useAppStore
          .getState()
          .setPaired('33333333-3333-4333-8333-333333333333');
        useAppStore.getState().reset();
      });
      expect(useAppStore.getState().pairedSessionId).toBeNull();
      expect(useAppStore.getState().connectionStatus).toBe('idle');
    });

    it('pairedSessionId is ephemeral — never persisted to disk', () => {
      act(() => {
        useAppStore
          .getState()
          .setPaired('44444444-4444-4444-8444-444444444444');
      });
      const blob = readPersistedBlob();
      expect(blob?.state).not.toHaveProperty('pairedSessionId');
      expect(blob?.state).not.toHaveProperty('connectionStatus');
    });
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
        'freeTierUsage',
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

  describe('hydration edge cases', () => {
    it('hydrates to defaults when no persisted key exists', () => {
      // Nothing seeded; beforeEach already cleared MMKV.
      const restored = restartAndGetState();
      expect(restored.role).toBeNull();
      expect(restored.onboardingCompleted).toBe(false);
      expect(restored.settings).toEqual({
        theme: 'system',
        alertSoundsEnabled: true,
        noiseThreshold: 0.6,
        motionSensitivity: 0.15,
        biometricLockEnabled: false,
        isPremium: false,
        powerSaverEnabled: true,
        audioOnlyEnabled: true,
      });
      expect(restored.connectionStatus).toBe('idle');
    });

    it('does not throw and falls back to defaults on a corrupted (non-JSON) blob', () => {
      seedPersistedRaw('{ this is : not valid json');

      let restored: AppState | undefined;
      expect(() => {
        restored = restartAndGetState();
      }).not.toThrow();

      // A garbage blob must not poison state: durable fields fall back to
      // their defaults rather than leaving the store unusable.
      expect(restored?.role).toBeNull();
      expect(restored?.onboardingCompleted).toBe(false);
      expect(restored?.settings).toEqual({
        theme: 'system',
        alertSoundsEnabled: true,
        noiseThreshold: 0.6,
        motionSensitivity: 0.15,
        biometricLockEnabled: false,
        isPremium: false,
        powerSaverEnabled: true,
        audioOnlyEnabled: true,
      });
    });

    it('does not throw on a valid-JSON blob with an unexpected shape', () => {
      // Well-formed JSON but with values that do not match the schema. The
      // store must survive (no crash on hydration) even if it cannot fully
      // recover every field.
      seedPersistedRaw(JSON.stringify({ state: { role: 12345 }, version: 0 }));
      expect(() => restartAndGetState()).not.toThrow();
    });

    it('repairs wrong-typed / out-of-range persisted fields to defaults (DMY-43)', () => {
      // A schema-violating blob: bad role, out-of-enum theme, out-of-range
      // scalar, wrong-typed boolean, and a broken freeTierUsage. Hydration must
      // drop each invalid value and fall back to the corresponding default
      // rather than smuggle garbage into runtime state.
      seedPersistedRaw(
        JSON.stringify({
          state: {
            role: 12345,
            onboardingCompleted: 'sure',
            settings: {
              theme: 'neon',
              alertSoundsEnabled: true,
              noiseThreshold: 9,
              motionSensitivity: 0.4,
              biometricLockEnabled: 'yes',
              isPremium: false,
              powerSaverEnabled: true,
              audioOnlyEnabled: true,
            },
            freeTierUsage: { usedMs: -10, dateKey: 'nope' },
          },
          version: 0,
        }),
      );

      const restored = restartAndGetState();
      // Invalid fields fell back to defaults...
      expect(restored.role).toBeNull();
      expect(restored.onboardingCompleted).toBe(false);
      expect(restored.settings.theme).toBe('system');
      expect(restored.settings.noiseThreshold).toBe(0.6);
      expect(restored.settings.biometricLockEnabled).toBe(false);
      expect(restored.freeTierUsage).toEqual({ usedMs: 0, dateKey: null });
      // ...while the one valid, non-default field was preserved.
      expect(restored.settings.motionSensitivity).toBe(0.4);
    });

    it('preserves a valid persisted scalar that is also schema-valid (DMY-43)', () => {
      seedPersistedRaw(
        JSON.stringify({
          state: {
            role: 'parent',
            onboardingCompleted: true,
            settings: {
              theme: 'dark',
              alertSoundsEnabled: false,
              noiseThreshold: 0.81,
              motionSensitivity: 0.22,
              biometricLockEnabled: true,
              isPremium: true,
              powerSaverEnabled: false,
              audioOnlyEnabled: false,
            },
            freeTierUsage: { usedMs: 60_000, dateKey: '2026-06-02' },
          },
          version: 0,
        }),
      );

      const restored = restartAndGetState();
      expect(restored.role).toBe('parent');
      expect(restored.settings.noiseThreshold).toBe(0.81);
      expect(restored.settings.isPremium).toBe(true);
      expect(restored.freeTierUsage).toEqual({
        usedMs: 60_000,
        dateKey: '2026-06-02',
      });
    });
  });

  describe('reset and persistence interaction', () => {
    it('reset clears the persisted blob back to defaults on disk', () => {
      act(() => {
        useAppStore.getState().setRole('baby');
        useAppStore.getState().setTheme('dark');
        useAppStore.getState().completeOnboarding();
      });
      // Sanity: non-default values reached disk.
      expect(readPersistedBlob()?.state.role).toBe('baby');

      act(() => {
        useAppStore.getState().reset();
      });

      const blob = readPersistedBlob();
      expect(blob?.state).toEqual({
        role: null,
        onboardingCompleted: false,
        settings: {
          theme: 'system',
          alertSoundsEnabled: true,
          noiseThreshold: 0.6,
          motionSensitivity: 0.15,
          biometricLockEnabled: false,
          isPremium: false,
          powerSaverEnabled: true,
          audioOnlyEnabled: true,
        },
        // reset() returns the counter to the empty default (no day stamped).
        freeTierUsage: { usedMs: 0, dateKey: null },
      });

      // And a restart after reset rehydrates to defaults, not stale values.
      const restored = restartAndGetState();
      expect(restored.role).toBeNull();
      expect(restored.settings.theme).toBe('system');
    });
  });

  describe('idempotency', () => {
    it('toggling alert sounds twice returns to the original value', () => {
      const initial = useAppStore.getState().settings.alertSoundsEnabled;
      act(() => {
        useAppStore.getState().toggleAlertSounds();
      });
      expect(useAppStore.getState().settings.alertSoundsEnabled).toBe(!initial);
      act(() => {
        useAppStore.getState().toggleAlertSounds();
      });
      expect(useAppStore.getState().settings.alertSoundsEnabled).toBe(initial);
    });
  });

  describe('noise threshold (DMY-8)', () => {
    it('updates the noise threshold within range', () => {
      act(() => {
        useAppStore.getState().setNoiseThreshold(0.75);
      });
      expect(useAppStore.getState().settings.noiseThreshold).toBe(0.75);
    });

    it('clamps out-of-range values to [0, 1]', () => {
      act(() => {
        useAppStore.getState().setNoiseThreshold(5);
      });
      expect(useAppStore.getState().settings.noiseThreshold).toBe(1);
      act(() => {
        useAppStore.getState().setNoiseThreshold(-3);
      });
      expect(useAppStore.getState().settings.noiseThreshold).toBe(0);
    });

    it('ignores non-finite values, keeping the previous threshold', () => {
      act(() => {
        useAppStore.getState().setNoiseThreshold(0.5);
        useAppStore.getState().setNoiseThreshold(NaN);
      });
      expect(useAppStore.getState().settings.noiseThreshold).toBe(0.5);
    });

    it('persists the noise threshold across a simulated restart', () => {
      act(() => {
        useAppStore.getState().setNoiseThreshold(0.42);
      });
      const restored = restartAndGetState();
      expect(restored.settings.noiseThreshold).toBe(0.42);
    });
  });

  describe('motion sensitivity (DMY-25)', () => {
    it('defaults to 0.15', () => {
      expect(useAppStore.getState().settings.motionSensitivity).toBe(0.15);
    });

    it('updates the motion sensitivity within range', () => {
      act(() => {
        useAppStore.getState().setMotionSensitivity(0.3);
      });
      expect(useAppStore.getState().settings.motionSensitivity).toBe(0.3);
    });

    it('clamps out-of-range values to [0, 1]', () => {
      act(() => {
        useAppStore.getState().setMotionSensitivity(5);
      });
      expect(useAppStore.getState().settings.motionSensitivity).toBe(1);
      act(() => {
        useAppStore.getState().setMotionSensitivity(-3);
      });
      expect(useAppStore.getState().settings.motionSensitivity).toBe(0);
    });

    it('ignores non-finite values, keeping the previous sensitivity', () => {
      act(() => {
        useAppStore.getState().setMotionSensitivity(0.25);
        useAppStore.getState().setMotionSensitivity(NaN);
      });
      expect(useAppStore.getState().settings.motionSensitivity).toBe(0.25);
    });

    it('persists the motion sensitivity across a simulated restart', () => {
      act(() => {
        useAppStore.getState().setMotionSensitivity(0.22);
      });
      const restored = restartAndGetState();
      expect(restored.settings.motionSensitivity).toBe(0.22);
    });

    it('backfills the default for an older blob without motionSensitivity', () => {
      seedPersistedRaw(
        JSON.stringify({
          state: {
            role: 'baby',
            onboardingCompleted: true,
            settings: {
              theme: 'dark',
              alertSoundsEnabled: true,
              noiseThreshold: 0.6,
              biometricLockEnabled: false,
              isPremium: false,
              powerSaverEnabled: true,
              audioOnlyEnabled: true,
            },
            freeTierUsage: { usedMs: 0, dateKey: null },
          },
          version: 0,
        }),
      );
      const restored = restartAndGetState();
      // Missing field backfilled to the default; saved fields preserved.
      expect(restored.settings.motionSensitivity).toBe(0.15);
      expect(restored.settings.theme).toBe('dark');
    });
  });

  describe('power-saver (DMY-12)', () => {
    it('defaults to enabled', () => {
      expect(useAppStore.getState().settings.powerSaverEnabled).toBe(true);
    });

    it('setPowerSaverEnabled toggles the flag', () => {
      act(() => useAppStore.getState().setPowerSaverEnabled(false));
      expect(useAppStore.getState().settings.powerSaverEnabled).toBe(false);
      act(() => useAppStore.getState().setPowerSaverEnabled(true));
      expect(useAppStore.getState().settings.powerSaverEnabled).toBe(true);
    });

    it('persists the power-saver setting across a simulated restart', () => {
      act(() => useAppStore.getState().setPowerSaverEnabled(false));
      const restored = restartAndGetState();
      expect(restored.settings.powerSaverEnabled).toBe(false);
    });

    it('backfills the default for an older blob without powerSaverEnabled', () => {
      // Simulate a pre-DMY-12 persisted shape: settings present but missing the
      // new flag. The defensive merge must backfill it to the default (true)
      // rather than leaving `undefined`.
      seedPersistedRaw(
        JSON.stringify({
          state: {
            role: 'baby',
            onboardingCompleted: true,
            settings: {
              theme: 'dark',
              alertSoundsEnabled: true,
              noiseThreshold: 0.6,
              biometricLockEnabled: false,
              isPremium: false,
            },
            freeTierUsage: { usedMs: 0, dateKey: null },
          },
          version: 0,
        }),
      );
      const restored = restartAndGetState();
      expect(restored.settings.powerSaverEnabled).toBe(true);
      // Saved fields are preserved.
      expect(restored.settings.theme).toBe('dark');
      expect(restored.role).toBe('baby');
    });
  });

  describe('audio-only (DMY-24)', () => {
    it('defaults to enabled', () => {
      expect(useAppStore.getState().settings.audioOnlyEnabled).toBe(true);
    });

    it('setAudioOnlyEnabled toggles the flag', () => {
      act(() => useAppStore.getState().setAudioOnlyEnabled(false));
      expect(useAppStore.getState().settings.audioOnlyEnabled).toBe(false);
      act(() => useAppStore.getState().setAudioOnlyEnabled(true));
      expect(useAppStore.getState().settings.audioOnlyEnabled).toBe(true);
    });

    it('persists the audio-only setting across a simulated restart', () => {
      act(() => useAppStore.getState().setAudioOnlyEnabled(false));
      const restored = restartAndGetState();
      expect(restored.settings.audioOnlyEnabled).toBe(false);
    });

    it('backfills the default for an older blob without audioOnlyEnabled', () => {
      // Simulate a pre-DMY-24 persisted shape: settings present but missing the
      // new flag. The defensive merge must backfill it to the default (true)
      // rather than leaving `undefined`.
      seedPersistedRaw(
        JSON.stringify({
          state: {
            role: 'parent',
            onboardingCompleted: true,
            settings: {
              theme: 'dark',
              alertSoundsEnabled: true,
              noiseThreshold: 0.6,
              biometricLockEnabled: false,
              isPremium: false,
              powerSaverEnabled: true,
            },
            freeTierUsage: { usedMs: 0, dateKey: null },
          },
          version: 0,
        }),
      );
      const restored = restartAndGetState();
      expect(restored.settings.audioOnlyEnabled).toBe(true);
      // Saved fields are preserved.
      expect(restored.settings.theme).toBe('dark');
      expect(restored.role).toBe('parent');
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

  describe('free-tier monetization (DMY-11)', () => {
    it('defaults to free (not premium) with an empty usage counter', () => {
      const state = useAppStore.getState();
      expect(state.settings.isPremium).toBe(false);
      expect(state.freeTierUsage).toEqual({ usedMs: 0, dateKey: null });
    });

    it('setPremium flips the placeholder entitlement flag', () => {
      act(() => useAppStore.getState().setPremium(true));
      expect(useAppStore.getState().settings.isPremium).toBe(true);
      act(() => useAppStore.getState().setPremium(false));
      expect(useAppStore.getState().settings.isPremium).toBe(false);
    });

    it('addFreeTierUsage accumulates and stamps today’s local date-key', () => {
      act(() => {
        useAppStore.getState().addFreeTierUsage(60_000);
        useAppStore.getState().addFreeTierUsage(30_000);
      });
      const usage = useAppStore.getState().freeTierUsage;
      expect(usage.usedMs).toBe(90_000);
      expect(usage.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('addFreeTierUsage ignores non-positive / non-finite deltas', () => {
      act(() => {
        useAppStore.getState().addFreeTierUsage(1000);
        useAppStore.getState().addFreeTierUsage(-5000);
        useAppStore.getState().addFreeTierUsage(NaN);
        useAppStore.getState().addFreeTierUsage(0);
      });
      expect(useAppStore.getState().freeTierUsage.usedMs).toBe(1000);
    });

    it('addFreeTierUsage is a no-op for premium users (no cap to track)', () => {
      act(() => {
        useAppStore.getState().setPremium(true);
        useAppStore.getState().addFreeTierUsage(120_000);
      });
      expect(useAppStore.getState().freeTierUsage.usedMs).toBe(0);
    });

    it('caps the accumulated counter at one hour', () => {
      act(() => {
        useAppStore.getState().addFreeTierUsage(10 * 60 * 60 * 1000);
      });
      expect(useAppStore.getState().freeTierUsage.usedMs).toBe(60 * 60 * 1000);
    });

    it('resets a stale (previous-day) counter to zero on the next usage', () => {
      // Seed a counter for a clearly-past day directly via the store mutator.
      act(() => useAppStore.getState().addFreeTierUsage(45 * 60 * 1000));
      // Force the stored dateKey to an old day to simulate the day having rolled.
      useAppStore.setState(s => ({
        freeTierUsage: {
          usedMs: s.freeTierUsage.usedMs,
          dateKey: '2000-01-01',
        },
      }));

      act(() => useAppStore.getState().addFreeTierUsage(60_000));
      const usage = useAppStore.getState().freeTierUsage;
      expect(usage.usedMs).toBe(60_000); // previous day's 45 min did not carry
      expect(usage.dateKey).not.toBe('2000-01-01');
    });

    it('resetFreeTierUsage zeroes the counter and stamps today', () => {
      act(() => {
        useAppStore.getState().addFreeTierUsage(120_000);
        useAppStore.getState().resetFreeTierUsage();
      });
      const usage = useAppStore.getState().freeTierUsage;
      expect(usage.usedMs).toBe(0);
      expect(usage.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('persists usage across a simulated restart (same-day cap survives)', () => {
      act(() => useAppStore.getState().addFreeTierUsage(40 * 60 * 1000));
      const restored = restartAndGetState();
      expect(restored.freeTierUsage.usedMs).toBe(40 * 60 * 1000);
    });

    it('backfills new fields when rehydrating a legacy blob (DMY-43 persist-gap)', () => {
      // A blob written before isPremium / freeTierUsage existed: settings has
      // the old shape and there is no freeTierUsage key at all.
      seedPersistedRaw(
        JSON.stringify({
          state: {
            role: 'parent',
            onboardingCompleted: true,
            settings: {
              theme: 'dark',
              alertSoundsEnabled: true,
              noiseThreshold: 0.6,
              biometricLockEnabled: false,
            },
          },
          version: 0,
        }),
      );

      const restored = restartAndGetState();
      // Old fields preserved...
      expect(restored.role).toBe('parent');
      expect(restored.settings.theme).toBe('dark');
      // ...and new fields backfilled to safe defaults (no undefined holes).
      expect(restored.settings.isPremium).toBe(false);
      expect(restored.freeTierUsage).toEqual({ usedMs: 0, dateKey: null });
    });
  });
});
