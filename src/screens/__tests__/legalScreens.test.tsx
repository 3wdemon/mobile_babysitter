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
import { version as packageJsonVersion } from '../../../package.json';
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

  // Drift guard: APP_VERSION is sourced from package.json `version`. Assert the
  // rendered string equals the ACTUAL package.json version read independently,
  // so a broken/forked version source (or stale rendered literal) is caught.
  // This is intentionally NOT phrased in terms of the APP_VERSION symbol, which
  // would make the assertion tautological (it imports the same value).
  it('renders the real package.json version, not a stale literal', async () => {
    renderLegalStack();
    await waitFor(() => {
      expect(screen.getByTestId('about-version')).toHaveTextContent(
        `Version ${packageJsonVersion}`,
      );
    });
    // Guard against an empty/undefined version silently passing the above.
    expect(packageJsonVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  // Edge: About is reachable as a no-param route and exposes the expected
  // accessibility roles (header for the title, link for the privacy entry).
  it('mounts with no params and exposes the expected a11y roles', async () => {
    renderLegalStack();
    await waitFor(() => {
      expect(screen.getByTestId('about-screen')).toBeOnTheScreen();
    });
    // Header role on the app name; link role on the privacy entry point.
    expect(screen.getByRole('header', { name: APP_NAME })).toBeOnTheScreen();
    expect(
      screen.getByRole('link', { name: 'Open the privacy policy' }),
    ).toBeOnTheScreen();
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

  it('exposes the placeholder banner as an alert and a header a11y role', async () => {
    renderLegalStack();
    fireEvent.press(await screen.findByTestId('about-privacy-link'));

    await waitFor(() => {
      expect(screen.getByTestId('privacy-policy-screen')).toBeOnTheScreen();
    });
    // The placeholder banner declares the `alert` a11y role and an accessible
    // label that names it as a placeholder, so assistive tech announces it.
    const banner = screen.getByTestId('placeholder-banner');
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(banner.props.accessibilityLabel).toMatch(/placeholder/i);
    expect(
      screen.getByRole('header', { name: 'Privacy Policy' }),
    ).toBeOnTheScreen();
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
