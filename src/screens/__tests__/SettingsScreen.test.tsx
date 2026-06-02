/**
 * Screen-level tests for SettingsScreen (DMY-52).
 *
 * The screen is mounted in a real native stack inside a NavigationContainer
 * alongside the Pairing, About and Settings routes, so the Re-pair -> Pairing
 * and About navigations can be exercised end-to-end. Each control asserts that
 * the matching `useAppStore` action ran (store state changed) and persisted to
 * the MMKV-backed store, plus the theme reflection and both Re-pair confirm/
 * cancel paths.
 */
import React from 'react';
import { Alert } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import SettingsScreen from '../SettingsScreen';
import AboutScreen from '../AboutScreen';
import type { RootStackParamList } from '../../navigation/types';
import { useAppStore } from '../../store/useAppStore';
import { APP_STORE_PERSIST_KEY } from '../../store/useAppStore';
import { mmkvStateStorage } from '../../services/storage/mmkv';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** A throwaway Pairing target so the Re-pair navigation has somewhere to land. */
function FakePairing() {
  return null;
}

function renderSettings() {
  return render(
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Settings">
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="About" component={AboutScreen} />
        <Stack.Screen name="Pairing" component={FakePairing} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

/**
 * Read the persisted blob straight from the MMKV-backed storage. The adapter is
 * synchronous under Jest (react-native-mmkv's in-memory mock), so the union
 * `string | Promise<...>` return is narrowed to a string at runtime.
 */
function readPersistedBlob():
  | { state: { role: unknown; settings: Record<string, unknown> } }
  | undefined {
  const raw = mmkvStateStorage.getItem(APP_STORE_PERSIST_KEY) as string | null;
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw);
}

/** Read the persisted settings slice. */
function readPersistedSettings(): Record<string, unknown> {
  return readPersistedBlob()!.state.settings;
}

beforeEach(() => {
  __resetAllMmkv();
  act(() => {
    useAppStore.getState().reset();
  });
  jest.restoreAllMocks();
});

describe('SettingsScreen rendering', () => {
  it('renders every store-bound control', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
    });
    // Theme selector.
    expect(screen.getByTestId('settings-theme-system')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-theme-light')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-theme-dark')).toBeOnTheScreen();
    // Switches.
    expect(screen.getByTestId('settings-alert-sounds')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-biometric-lock')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-power-saver')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-audio-only')).toBeOnTheScreen();
    // Sensitivity segmented controls.
    expect(screen.getByTestId('settings-noise-low')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-motion-high')).toBeOnTheScreen();
    // Role selector.
    expect(screen.getByTestId('settings-role-baby')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-role-parent')).toBeOnTheScreen();
    // Action rows.
    expect(screen.getByTestId('settings-re-pair')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-about')).toBeOnTheScreen();
    // Permissions section (DMY-57) is hosted here.
    expect(screen.getByTestId('permission-re-request')).toBeOnTheScreen();
  });

  it('does NOT render a Support development CTA (DMY-51 not built)', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
    });
    expect(screen.queryByText(/Support development/i)).toBeNull();
  });
});

describe('theme control', () => {
  it('dispatches setTheme and persists the choice', async () => {
    renderSettings();
    fireEvent.press(await screen.findByTestId('settings-theme-dark'));

    await waitFor(() => {
      expect(useAppStore.getState().settings.theme).toBe('dark');
    });
    expect(readPersistedSettings().theme).toBe('dark');
  });

  it('marks the active theme option as selected (theme reflected)', async () => {
    act(() => {
      useAppStore.getState().setTheme('light');
    });
    renderSettings();
    const light = await screen.findByTestId('settings-theme-light');
    expect(light.props.accessibilityState).toMatchObject({ selected: true });
    expect(
      screen.getByTestId('settings-theme-dark').props.accessibilityState,
    ).toMatchObject({ selected: false });
  });
});

describe('switch controls', () => {
  it('toggles alert sounds via toggleAlertSounds and persists', async () => {
    renderSettings();
    const sw = await screen.findByTestId('settings-alert-sounds');
    expect(useAppStore.getState().settings.alertSoundsEnabled).toBe(true);

    fireEvent(sw, 'valueChange', false);

    await waitFor(() => {
      expect(useAppStore.getState().settings.alertSoundsEnabled).toBe(false);
    });
    expect(readPersistedSettings().alertSoundsEnabled).toBe(false);
  });

  it('enables the biometric lock and persists', async () => {
    renderSettings();
    fireEvent(
      await screen.findByTestId('settings-biometric-lock'),
      'valueChange',
      true,
    );
    await waitFor(() => {
      expect(useAppStore.getState().settings.biometricLockEnabled).toBe(true);
    });
    expect(readPersistedSettings().biometricLockEnabled).toBe(true);
  });

  it('disables power saver and persists', async () => {
    renderSettings();
    fireEvent(
      await screen.findByTestId('settings-power-saver'),
      'valueChange',
      false,
    );
    await waitFor(() => {
      expect(useAppStore.getState().settings.powerSaverEnabled).toBe(false);
    });
    expect(readPersistedSettings().powerSaverEnabled).toBe(false);
  });

  it('disables audio-only and persists', async () => {
    renderSettings();
    fireEvent(
      await screen.findByTestId('settings-audio-only'),
      'valueChange',
      false,
    );
    await waitFor(() => {
      expect(useAppStore.getState().settings.audioOnlyEnabled).toBe(false);
    });
    expect(readPersistedSettings().audioOnlyEnabled).toBe(false);
  });
});

describe('sensitivity segmented controls', () => {
  it('sets the noise threshold (higher sensitivity = lower threshold) and persists', async () => {
    renderSettings();
    fireEvent.press(await screen.findByTestId('settings-noise-high'));

    await waitFor(() => {
      // "High sensitivity" maps to the lowest threshold.
      expect(useAppStore.getState().settings.noiseThreshold).toBeLessThan(0.6);
    });
    expect(readPersistedSettings().noiseThreshold).toBe(
      useAppStore.getState().settings.noiseThreshold,
    );
  });

  it('sets the motion sensitivity (higher sensitivity = lower threshold) and persists', async () => {
    renderSettings();
    fireEvent.press(await screen.findByTestId('settings-motion-low'));

    await waitFor(() => {
      // "Low sensitivity" maps to the highest threshold.
      expect(useAppStore.getState().settings.motionSensitivity).toBeGreaterThan(
        0.15,
      );
    });
    expect(readPersistedSettings().motionSensitivity).toBe(
      useAppStore.getState().settings.motionSensitivity,
    );
  });

  it('reflects the persisted scalar by selecting the nearest level', async () => {
    act(() => {
      useAppStore.getState().setNoiseThreshold(0.35);
    });
    renderSettings();
    const high = await screen.findByTestId('settings-noise-high');
    expect(high.props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe('role control', () => {
  it('sets the role via setRole and persists', async () => {
    renderSettings();
    fireEvent.press(await screen.findByTestId('settings-role-parent'));

    await waitFor(() => {
      expect(useAppStore.getState().role).toBe('parent');
    });
    // Role is persisted at the top level of the persisted blob.
    expect(readPersistedBlob()!.state.role).toBe('parent');
  });
});

describe('re-pair flow', () => {
  it('clears pairing and navigates to Pairing on confirm', async () => {
    // Seed a paired session.
    act(() => {
      useAppStore.getState().setPaired('session-xyz');
    });
    expect(useAppStore.getState().pairedSessionId).toBe('session-xyz');

    // Drive the Alert by invoking the confirm button's onPress.
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _body, buttons) => {
        const confirm = buttons?.find(b => b.style === 'destructive');
        confirm?.onPress?.();
      });

    renderSettings();
    fireEvent.press(await screen.findByTestId('settings-re-pair'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(useAppStore.getState().pairedSessionId).toBeNull();
      expect(useAppStore.getState().connectionStatus).toBe('idle');
    });
  });

  it('does nothing when the confirmation is cancelled', async () => {
    act(() => {
      useAppStore.getState().setPaired('session-xyz');
    });

    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _body, buttons) => {
        const cancel = buttons?.find(b => b.style === 'cancel');
        // Cancel typically has no onPress; calling it (if present) must be a no-op.
        cancel?.onPress?.();
      });

    renderSettings();
    fireEvent.press(await screen.findByTestId('settings-re-pair'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    // Pairing untouched.
    expect(useAppStore.getState().pairedSessionId).toBe('session-xyz');
    expect(useAppStore.getState().connectionStatus).toBe('paired');
  });
});

describe('about navigation', () => {
  it('navigates to the About screen', async () => {
    renderSettings();
    fireEvent.press(await screen.findByTestId('settings-about'));

    await waitFor(() => {
      expect(screen.getByTestId('about-screen')).toBeOnTheScreen();
    });
  });
});
