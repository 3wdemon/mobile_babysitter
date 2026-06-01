/**
 * @format
 *
 * Smoke test for the app shell: App now mounts a NavigationContainer with the
 * RootNavigator. The "Mobile Babysitter" title moved into PairingScreen (the
 * initial route), so the smoke assertion checks that route renders.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import App from '../App';

// react-native-safe-area-context and react-native-screens are mocked globally
// in jest.setup.js so the navigation tree mounts in the test renderer.

test('renders without crashing', () => {
  expect(() => render(<App />)).not.toThrow();
});

test('renders the initial Pairing route with the app title', async () => {
  render(<App />);

  // The title now lives on the initial PairingScreen.
  await waitFor(() => {
    expect(screen.getAllByText('Mobile Babysitter').length).toBeGreaterThan(0);
  });
});
