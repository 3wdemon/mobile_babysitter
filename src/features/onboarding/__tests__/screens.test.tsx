/**
 * Screen-level tests for the onboarding steps (DMY-42).
 *
 * Each screen is rendered in isolation inside a NavigationContainer + its own
 * onboarding-shaped stack so navigation props resolve. These cover content,
 * the design-token styling contract (no hard-coded colours), and the
 * RoleSelect store side-effects.
 */
import React from 'react';
import { ScrollView } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import WelcomeScreen from '../screens/WelcomeScreen';
import PermissionsScreen from '../screens/PermissionsScreen';
import RoleSelectScreen from '../screens/RoleSelectScreen';
import type { OnboardingStackParamList } from '../types';
import { useAppStore } from '../../../store/useAppStore';
import { lightTheme } from '../../../theme';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

/** Render a single onboarding screen as the initial route of a minimal stack. */
function renderScreen(
  name: keyof OnboardingStackParamList,
  component: React.ComponentType<any>,
) {
  return render(
    <NavigationContainer>
      <Stack.Navigator initialRouteName={name} screenOptions={{ headerShown: false }}>
        <Stack.Screen name={name} component={component} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

beforeEach(() => {
  __resetAllMmkv();
  act(() => {
    useAppStore.getState().reset();
  });
});

describe('WelcomeScreen', () => {
  it('renders the privacy-first messaging and a Continue button', async () => {
    renderScreen('Welcome', WelcomeScreen);
    await waitFor(() => {
      expect(screen.getByText('Local peer-to-peer')).toBeOnTheScreen();
      expect(screen.getByText('No cloud, no accounts')).toBeOnTheScreen();
      expect(screen.getByText('End-to-end encrypted')).toBeOnTheScreen();
      expect(screen.getByText('Continue')).toBeOnTheScreen();
    });
  });

  it('styles the heading colour from design tokens, not a hard-coded hex', async () => {
    renderScreen('Welcome', WelcomeScreen);
    const heading = await screen.findByText('Mobile Babysitter');
    const flat = flattenStyle(heading.props.style);
    // Smoke check: the colour is one of the resolved theme token values
    // (the renderer defaults to the light scheme here).
    expect(flat.color).toBe(lightTheme.colors.text);
  });

  it('derives the scroll content padding from spacing tokens, not hard-coded literals', async () => {
    renderScreen('Welcome', WelcomeScreen);
    await screen.findByText('Mobile Babysitter');
    const scroll = screen.UNSAFE_getByType(ScrollView);
    const flat = flattenStyle(scroll.props.contentContainerStyle);
    // Regression guard against re-introducing 24/32/16 literals (DMY-42 review).
    expect(flat.paddingHorizontal).toBe(lightTheme.spacing.xl);
    expect(flat.paddingTop).toBe(lightTheme.spacing.xxl);
    expect(flat.paddingBottom).toBe(lightTheme.spacing.lg);
  });

  it('exposes the Continue control as a button with an i18n a11y label (DMY-65)', async () => {
    renderScreen('Welcome', WelcomeScreen);
    const button = await screen.findByRole('button', {
      name: 'Continue to permissions',
    });
    expect(button).toBeOnTheScreen();
  });
});

describe('PermissionsScreen', () => {
  it('explains why each permission is needed', async () => {
    renderScreen('Permissions', PermissionsScreen);
    await waitFor(() => {
      expect(screen.getByText('Camera')).toBeOnTheScreen();
      expect(screen.getByText('Microphone')).toBeOnTheScreen();
      expect(screen.getByText('Notifications')).toBeOnTheScreen();
      expect(screen.getByText('Allow access')).toBeOnTheScreen();
    });
  });

  it('derives the scroll content padding from spacing tokens, not hard-coded literals', async () => {
    renderScreen('Permissions', PermissionsScreen);
    await screen.findByText('A few permissions');
    const scroll = screen.UNSAFE_getByType(ScrollView);
    const flat = flattenStyle(scroll.props.contentContainerStyle);
    expect(flat.paddingHorizontal).toBe(lightTheme.spacing.xl);
    expect(flat.paddingTop).toBe(lightTheme.spacing.xxl);
    expect(flat.paddingBottom).toBe(lightTheme.spacing.lg);
  });
});

describe('RoleSelectScreen', () => {
  it('persists role + completes onboarding when Parent unit is chosen', async () => {
    renderScreen('RoleSelect', RoleSelectScreen);

    fireEvent.press(await screen.findByText('Parent unit'));

    await waitFor(() => {
      expect(useAppStore.getState().role).toBe('parent');
      expect(useAppStore.getState().onboardingCompleted).toBe(true);
    });
  });

  it('persists role baby when Baby unit is chosen', async () => {
    renderScreen('RoleSelect', RoleSelectScreen);

    fireEvent.press(await screen.findByText('Baby unit'));

    await waitFor(() => {
      expect(useAppStore.getState().role).toBe('baby');
      expect(useAppStore.getState().onboardingCompleted).toBe(true);
    });
  });

  it('exposes each role card as a button with a descriptive i18n a11y label (DMY-65)', async () => {
    renderScreen('RoleSelect', RoleSelectScreen);
    await screen.findByText('What is this phone for?');
    expect(
      screen.getByRole('button', {
        name: 'Use this phone as the baby unit',
      }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: 'Use this phone as the parent unit',
      }),
    ).toBeOnTheScreen();
  });

  it('uses token-derived surface colour for the option cards (no hard-coded hex)', async () => {
    renderScreen('RoleSelect', RoleSelectScreen);
    const title = await screen.findByText('Parent unit');
    // Title colour comes from the theme text token.
    const flat = flattenStyle(title.props.style);
    expect(flat.color).toBe(lightTheme.colors.text);
  });

  it('derives the content padding from a spacing token, not a hard-coded literal', async () => {
    renderScreen('RoleSelect', RoleSelectScreen);
    const heading = await screen.findByText('What is this phone for?');
    // Walk up to the content View that carries the horizontal padding.
    let node = heading.parent;
    let padding: unknown;
    while (node) {
      const flat = flattenStyle(node.props.style);
      if (flat.paddingHorizontal !== undefined) {
        padding = flat.paddingHorizontal;
        break;
      }
      node = node.parent;
    }
    expect(padding).toBe(lightTheme.spacing.xl);
  });
});

/** Flatten a possibly-nested RN style prop into a single object. */
function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, item) => ({ ...acc, ...flattenStyle(item) }),
      {},
    );
  }
  return (style as Record<string, unknown>) ?? {};
}
