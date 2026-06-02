/**
 * i18n migration test for WelcomeScreen (DMY-63).
 *
 * Mounts the real WelcomeScreen in a NavigationContainer and asserts it renders
 * strings sourced from the locale catalogs — English by default, Russian after
 * switching the active locale — rather than hard-coded literals. This is the
 * "at least one migrated screen renders catalog strings" coverage.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import WelcomeScreen from '../screens/WelcomeScreen';
import type { OnboardingStackParamList } from '../types';
import en from '../../../../locales/en.json';
import ru from '../../../../locales/ru.json';
import { setLocale } from '../../../services/i18n';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

function renderWelcome() {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

afterEach(() => {
  setLocale('en');
});

describe('WelcomeScreen i18n', () => {
  it('renders English catalog strings under the en locale', async () => {
    setLocale('en');
    renderWelcome();
    await waitFor(() => {
      expect(
        screen.getByText(en.onboarding.welcome.subtitle),
      ).toBeOnTheScreen();
      expect(
        screen.getByText(en.onboarding.welcome.highlights.noCloud.title),
      ).toBeOnTheScreen();
      expect(
        screen.getByText(en.onboarding.welcome.continue),
      ).toBeOnTheScreen();
    });
  });

  it('renders Russian catalog strings under the ru locale', async () => {
    setLocale('ru');
    renderWelcome();
    await waitFor(() => {
      expect(
        screen.getByText(ru.onboarding.welcome.subtitle),
      ).toBeOnTheScreen();
      expect(
        screen.getByText(ru.onboarding.welcome.highlights.noCloud.title),
      ).toBeOnTheScreen();
      expect(
        screen.getByText(ru.onboarding.welcome.continue),
      ).toBeOnTheScreen();
    });
  });

  it('re-renders into Russian when the locale switches while mounted', async () => {
    setLocale('en');
    renderWelcome();
    await waitFor(() =>
      expect(screen.getByText(en.onboarding.welcome.continue)).toBeOnTheScreen(),
    );

    act(() => {
      setLocale('ru');
    });

    await waitFor(() =>
      expect(screen.getByText(ru.onboarding.welcome.continue)).toBeOnTheScreen(),
    );
  });
});
