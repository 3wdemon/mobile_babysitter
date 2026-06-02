/**
 * Screen-level tests for the legal screens (DMY-64): AboutScreen and
 * PrivacyPolicyScreen.
 *
 * Both screens are mounted in a real two-route native stack inside a
 * NavigationContainer so the About -> PrivacyPolicy link can be exercised
 * end-to-end. Tests cover: required About content (name + version + privacy
 * link), the link navigating, the placeholder markers on the policy, and the
 * privacy invariant that no real user/PII is rendered.
 */
import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import AboutScreen from '../AboutScreen';
import PrivacyPolicyScreen from '../PrivacyPolicyScreen';
import { APP_NAME, APP_VERSION } from '../../constants/appInfo';
import type { RootStackParamList } from '../../navigation/types';
import { useAppStore } from '../../store/useAppStore';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Mount both legal routes with About as the initial route. */
function renderLegalStack() {
  return render(
    <NavigationContainer>
      <Stack.Navigator initialRouteName="About">
        <Stack.Screen name="About" component={AboutScreen} />
        <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
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

describe('AboutScreen', () => {
  it('shows the app name, version, and a privacy policy link', async () => {
    renderLegalStack();
    await waitFor(() => {
      expect(screen.getByTestId('about-app-name')).toHaveTextContent(APP_NAME);
      expect(screen.getByTestId('about-version')).toHaveTextContent(
        `Version ${APP_VERSION}`,
      );
      expect(screen.getByTestId('about-privacy-link')).toBeOnTheScreen();
    });
  });

  it('navigates to the Privacy Policy when the link is pressed', async () => {
    renderLegalStack();
    await waitFor(() => {
      expect(screen.getByTestId('about-privacy-link')).toBeOnTheScreen();
    });

    fireEvent.press(screen.getByTestId('about-privacy-link'));

    await waitFor(() => {
      expect(screen.getByTestId('privacy-policy-screen')).toBeOnTheScreen();
    });
  });
});

describe('PrivacyPolicyScreen', () => {
  it('renders the placeholder markers and P2P / no-cloud / no-account copy', async () => {
    renderLegalStack();
    fireEvent.press(await screen.findByTestId('about-privacy-link'));

    await waitFor(() => {
      // Explicitly marked as a placeholder.
      expect(screen.getByTestId('placeholder-banner')).toBeOnTheScreen();
      expect(screen.getByText(/PLACEHOLDER/)).toBeOnTheScreen();
      // The three privacy-positioning points are present.
      expect(screen.getByTestId('privacy-point-p2p')).toBeOnTheScreen();
      expect(screen.getByTestId('privacy-point-no-cloud')).toBeOnTheScreen();
      expect(screen.getByTestId('privacy-point-no-account')).toBeOnTheScreen();
      expect(screen.getByText(/Peer-to-peer/i)).toBeOnTheScreen();
      expect(screen.getByText(/No cloud/i)).toBeOnTheScreen();
      expect(screen.getByText(/No account/i)).toBeOnTheScreen();
    });
  });
});

describe('privacy invariant', () => {
  it('renders no real user data or PII on either screen', async () => {
    // Seed the store with values that would be sensitive if leaked into the UI.
    act(() => {
      useAppStore.setState({
        pairedSessionId: 'session-secret-1234',
      } as never);
    });

    const { toJSON } = renderLegalStack();
    await waitFor(() => {
      expect(screen.getByTestId('about-app-name')).toBeOnTheScreen();
    });
    fireEvent.press(screen.getByTestId('about-privacy-link'));
    await waitFor(() => {
      expect(screen.getByTestId('privacy-policy-screen')).toBeOnTheScreen();
    });

    // The rendered tree must not contain any seeded session/PII-like values.
    const tree = JSON.stringify(toJSON());
    expect(tree).not.toContain('session-secret-1234');
    expect(tree).not.toMatch(/@/); // no email addresses rendered
  });
});
