/**
 * @format
 *
 * DMY-58 — bootsplash hide wiring. react-native-bootsplash is mocked globally
 * (jest.setup.js -> __mocks__/react-native-bootsplash.ts) with an inert `hide`
 * spy. These tests assert the JS-level contract:
 *  - hide() fires once the navigator signals ready (ready === true), and
 *  - it is called exactly once even across re-renders / repeated ready signals.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import BootSplash from 'react-native-bootsplash';

import Splash, { useHideBootSplash } from '../src/components/Splash';

const hideMock = BootSplash.hide as jest.Mock;

// Test harness so we can flip `ready` like NavigationContainer's onReady does.
function Harness({ ready }: { ready: boolean }) {
  useHideBootSplash(ready);
  return null;
}

beforeEach(() => {
  hideMock.mockClear();
});

test('does not hide while the navigator is not ready', () => {
  render(<Harness ready={false} />);
  expect(hideMock).not.toHaveBeenCalled();
});

test('hides with a fade once the navigator becomes ready', () => {
  const { rerender } = render(<Harness ready={false} />);
  expect(hideMock).not.toHaveBeenCalled();

  rerender(<Harness ready={true} />);

  expect(hideMock).toHaveBeenCalledTimes(1);
  expect(hideMock).toHaveBeenCalledWith({ fade: true });
});

test('hides exactly once across re-renders after ready', () => {
  const { rerender } = render(<Harness ready={true} />);
  rerender(<Harness ready={true} />);
  rerender(<Harness ready={true} />);

  expect(hideMock).toHaveBeenCalledTimes(1);
});

test('Splash component hides the bootsplash on mount', () => {
  render(<Splash />);
  expect(hideMock).toHaveBeenCalledTimes(1);
  expect(hideMock).toHaveBeenCalledWith({ fade: true });
});
