/**
 * Integration tests for the onboarding gating + flow (DMY-42).
 *
 * Mounts the real App (RootNavigator + store + onboarding stack) so the gating
 * on `onboardingCompleted` and the role-completion handoff are exercised
 * end-to-end. react-native-permissions and the navigation native deps are
 * mocked globally (jest.setup.js).
 */
import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import App from '../../../../App';
import { useAppStore } from '../../../store/useAppStore';
import {
  RESULTS,
  requestMultiple,
  requestNotifications,
} from 'react-native-permissions';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

const mockRequestMultiple = requestMultiple as jest.MockedFunction<
  typeof requestMultiple
>;
const mockRequestNotifications = requestNotifications as jest.MockedFunction<
  typeof requestNotifications
>;

beforeEach(() => {
  jest.clearAllMocks();
  __resetAllMmkv();
  act(() => {
    useAppStore.getState().reset();
  });
  mockRequestMultiple.mockImplementation(async (permissions: string[]) => {
    const result: Record<string, string> = {};
    for (const p of permissions) result[p] = RESULTS.GRANTED;
    return result as never;
  });
  mockRequestNotifications.mockResolvedValue({ status: RESULTS.GRANTED } as never);
});

describe('onboarding gating', () => {
  it('shows the Welcome screen on first launch (onboardingCompleted = false)', async () => {
    render(<App />);

    await waitFor(() => {
      // Welcome privacy-first copy is present; the main Pairing flow is NOT.
      expect(screen.getByText('No cloud, no accounts')).toBeOnTheScreen();
    });
    expect(screen.queryByText('Use as Baby unit')).toBeNull();
  });

  it('skips onboarding and opens the Parent screen when already completed as parent', async () => {
    act(() => {
      useAppStore.getState().setRole('parent');
      useAppStore.getState().completeOnboarding();
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Parent unit')).toBeOnTheScreen();
    });
    // Onboarding copy must not appear.
    expect(screen.queryByText('No cloud, no accounts')).toBeNull();
  });

  it('skips onboarding and opens the Baby screen when already completed as baby', async () => {
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().completeOnboarding();
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Baby unit')).toBeOnTheScreen();
    });
  });
});

describe('onboarding flow', () => {
  it('walks Welcome -> Permissions -> RoleSelect and completes as parent', async () => {
    render(<App />);

    // Welcome -> Continue.
    await waitFor(() => screen.getByText('Continue'));
    fireEvent.press(screen.getByText('Continue'));

    // Permissions step.
    await waitFor(() => screen.getByText('Allow access'));
    await act(async () => {
      fireEvent.press(screen.getByText('Allow access'));
    });

    // After requesting, the per-permission status appears and Continue shows.
    await waitFor(() => {
      expect(mockRequestMultiple).toHaveBeenCalledTimes(1);
      expect(mockRequestNotifications).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Continue')).toBeOnTheScreen();
    });
    fireEvent.press(screen.getByText('Continue'));

    // RoleSelect -> choose Parent unit.
    await waitFor(() => screen.getByText('Parent unit'));
    fireEvent.press(screen.getByText('Parent unit'));

    // Store updated and RootNavigator swapped to the Parent main screen.
    await waitFor(() => {
      const state = useAppStore.getState();
      expect(state.role).toBe('parent');
      expect(state.onboardingCompleted).toBe(true);
    });
  });

  it('completes as baby when Baby unit is selected', async () => {
    render(<App />);

    await waitFor(() => screen.getByText('Continue'));
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => screen.getByText('Allow access'));
    await act(async () => {
      fireEvent.press(screen.getByText('Allow access'));
    });

    await waitFor(() => screen.getByText('Continue'));
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => screen.getByText('Baby unit'));
    fireEvent.press(screen.getByText('Baby unit'));

    await waitFor(() => {
      expect(useAppStore.getState().role).toBe('baby');
      expect(useAppStore.getState().onboardingCompleted).toBe(true);
    });
  });

  it('lets the user continue gracefully when permissions are denied', async () => {
    // All permissions denied — flow must NOT break.
    mockRequestMultiple.mockImplementation(async (permissions: string[]) => {
      const result: Record<string, string> = {};
      for (const p of permissions) result[p] = RESULTS.DENIED;
      return result as never;
    });
    mockRequestNotifications.mockResolvedValue({
      status: RESULTS.BLOCKED,
    } as never);

    render(<App />);

    await waitFor(() => screen.getByText('Continue'));
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => screen.getByText('Allow access'));
    await act(async () => {
      fireEvent.press(screen.getByText('Allow access'));
    });

    // A denied status is surfaced inline, and Continue still advances.
    await waitFor(() => {
      expect(screen.getAllByText('Not granted').length).toBeGreaterThan(0);
      expect(screen.getByText('Blocked — enable in Settings')).toBeOnTheScreen();
    });

    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => screen.getByText('Parent unit'));
    fireEvent.press(screen.getByText('Parent unit'));

    await waitFor(() => {
      expect(useAppStore.getState().onboardingCompleted).toBe(true);
      expect(useAppStore.getState().role).toBe('parent');
    });
  });

  it('allows skipping permissions entirely and still completing onboarding', async () => {
    render(<App />);

    await waitFor(() => screen.getByText('Continue'));
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => screen.getByText('Skip for now'));
    fireEvent.press(screen.getByText('Skip for now'));

    // No permission request was made.
    expect(mockRequestMultiple).not.toHaveBeenCalled();

    await waitFor(() => screen.getByText('Baby unit'));
    fireEvent.press(screen.getByText('Baby unit'));

    await waitFor(() => {
      expect(useAppStore.getState().onboardingCompleted).toBe(true);
      expect(useAppStore.getState().role).toBe('baby');
    });
  });
});
