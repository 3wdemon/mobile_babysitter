/**
 * @format
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import App from '../App';

// SafeAreaProvider waits for a native layout event before rendering its
// children, which never fires in the test environment. Mock the module so the
// provider renders synchronously and exposes static insets, letting the app
// tree mount.
jest.mock('react-native-safe-area-context', () => {
  const inset = { top: 47, right: 0, bottom: 34, left: 0 };
  const frame = { width: 390, height: 844, x: 0, y: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaConsumer: ({
      children,
    }: {
      children: (insets: typeof inset) => React.ReactNode;
    }) => children(inset),
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => frame,
  };
});

test('renders the "Mobile Babysitter" title', () => {
  render(<App />);

  expect(screen.getByText('Mobile Babysitter')).toBeOnTheScreen();
});
