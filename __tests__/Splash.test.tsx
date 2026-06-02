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
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import BootSplash from 'react-native-bootsplash';

import Splash, { useHideBootSplash } from '../src/components/Splash';
import ErrorBoundary from '../src/components/ErrorBoundary';

jest.mock('../src/services/logger', () => ({
  logger: { error: jest.fn() },
}));

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

// DMY-58 edge: in App.tsx the onReady hide (useHideBootSplash) and the crash-path
// hide (ErrorBoundary.componentDidCatch) live in the SAME tree. A navigator that
// mounts (onReady -> hide #1) and then throws on a later render (componentDidCatch
// -> hide #2) drives BOTH paths sequentially. The JS contract must stay idempotent:
// hide is invoked on each transition, nothing throws, and there is no double-guard
// that would swallow the crash-path hide. This mirrors App's ErrorBoundary-wraps-
// navigator topology and exercises the combined sequence end to end.
describe('combined onReady + ErrorBoundary paths (App topology)', () => {
  // Mirrors App.tsx: a consumer that hides on ready, wrapped by ErrorBoundary,
  // that can be flipped to throw on a subsequent render.
  function ReadyThenBoom({
    ready,
    crash,
  }: {
    ready: boolean;
    crash: boolean;
  }) {
    useHideBootSplash(ready);
    if (crash) {
      throw new Error('navigator blew up after mount');
    }
    return <Text>healthy navigator</Text>;
  }

  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // React logs the caught render error via console.error; silence it.
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('onReady-then-crash fires hide on both transitions without throwing', () => {
    const { rerender, getByText } = render(
      <ErrorBoundary>
        <ReadyThenBoom ready crash={false} />
      </ErrorBoundary>,
    );

    // onReady path: hidden once on the healthy mount.
    expect(getByText('healthy navigator')).toBeTruthy();
    expect(hideMock).toHaveBeenCalledTimes(1);
    expect(hideMock).toHaveBeenCalledWith({ fade: true });

    // A later render throws: the ErrorBoundary must catch it (no escape) and the
    // crash-path hide must still fire, on top of the earlier onReady hide.
    expect(() =>
      rerender(
        <ErrorBoundary>
          <ReadyThenBoom ready crash />
        </ErrorBoundary>,
      ),
    ).not.toThrow();

    // Both paths fired: total of two hide calls, each a fade. Idempotency is
    // owned by the native side (a second hide after the splash is gone is a
    // no-op); the JS layer must not suppress the crash-path call.
    expect(hideMock).toHaveBeenCalledTimes(2);
    expect(hideMock).toHaveBeenNthCalledWith(2, { fade: true });
  });

  test('a rejected native hide on the crash path never escapes', () => {
    // hideBootSplash swallows hide() rejections (a missing / already-hidden
    // splash must never crash the app). Simulate the native bridge rejecting on
    // the crash-path hide and assert the rejection does not surface.
    hideMock.mockReturnValueOnce(Promise.reject(new Error('native bridge gone')));

    expect(() =>
      render(
        <ErrorBoundary>
          <ReadyThenBoom ready crash />
        </ErrorBoundary>,
      ),
    ).not.toThrow();

    expect(hideMock).toHaveBeenCalledTimes(1);
  });
});
