/**
 * @format
 *
 * Navigation tests for the root native stack (DMY-35):
 *  - the initial route (Pairing) renders,
 *  - tapping a button navigates to the target screen,
 *  - the system back action returns to the previous screen,
 *  - RootStackParamList is type-safe (navigating to an unknown route is a
 *    compile error — asserted via @ts-expect-error).
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer, type NavigationContainerRef } from '@react-navigation/native';

import RootNavigator from '../src/navigation/RootNavigator';
import type { RootStackParamList } from '../src/navigation/types';

// react-native-safe-area-context and react-native-screens are mocked globally
// in jest.setup.js so the navigation tree mounts in the test renderer.

function renderNavigator() {
  const ref = React.createRef<NavigationContainerRef<RootStackParamList>>();
  const utils = render(
    <NavigationContainer ref={ref}>
      <RootNavigator />
    </NavigationContainer>,
  );
  return { ref, ...utils };
}

test('renders the initial Pairing route', async () => {
  renderNavigator();

  await waitFor(() => {
    expect(screen.getByText('Use as Baby unit')).toBeOnTheScreen();
    expect(screen.getByText('Use as Parent unit')).toBeOnTheScreen();
  });
});

test('navigates from Pairing to Baby and back', async () => {
  const { ref } = renderNavigator();

  await waitFor(() => screen.getByText('Use as Baby unit'));

  fireEvent.press(screen.getByText('Use as Baby unit'));

  await waitFor(() => {
    expect(screen.getByText('Baby unit')).toBeOnTheScreen();
    expect(ref.current?.getCurrentRoute()?.name).toBe('Baby');
  });

  // System back action returns to the Pairing route.
  act(() => {
    ref.current?.goBack();
  });

  await waitFor(() => {
    expect(ref.current?.getCurrentRoute()?.name).toBe('Pairing');
  });
});

test('navigates to Parent via navigation ref and goes back', async () => {
  const { ref } = renderNavigator();

  await waitFor(() => screen.getByText('Use as Parent unit'));

  fireEvent.press(screen.getByText('Use as Parent unit'));

  await waitFor(() => {
    expect(ref.current?.getCurrentRoute()?.name).toBe('Parent');
  });

  // System back action returns to the initial route.
  act(() => {
    ref.current?.goBack();
  });

  await waitFor(() => {
    expect(ref.current?.getCurrentRoute()?.name).toBe('Pairing');
  });
});

test('RootStackParamList rejects unknown routes at compile time', async () => {
  const { ref } = renderNavigator();

  await waitFor(() => screen.getByText('Use as Baby unit'));

  // Type-level guard: navigating to a valid route compiles, an unknown route
  // does not. We capture the call in a never-invoked closure so tsc still
  // type-checks it without emitting a runtime "unknown route" warning.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _typeCheck = () => {
    ref.current?.navigate('Parent');
    // @ts-expect-error 'Nursery' is not a member of RootStackParamList.
    ref.current?.navigate('Nursery');
  };

  // Valid navigation still works at runtime.
  act(() => {
    ref.current?.navigate('Parent');
  });

  await waitFor(() => {
    expect(ref.current?.getCurrentRoute()?.name).toBe('Parent');
  });
});
