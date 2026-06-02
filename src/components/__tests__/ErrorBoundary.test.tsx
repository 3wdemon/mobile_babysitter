/**
 * Tests for the top-level ErrorBoundary + default ErrorFallback (DMY-41).
 */
import { Text, TouchableOpacity } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import BootSplash from 'react-native-bootsplash';

import ErrorBoundary from '../ErrorBoundary';
import { logger } from '../../services/logger';

// Spy on the app logger so we assert the boundary routes errors through it
// (with redaction) rather than calling console.error directly.
jest.mock('../../services/logger', () => ({
  logger: { error: jest.fn() },
}));

const mockedLoggerError = logger.error as jest.Mock;
// react-native-bootsplash is mocked globally (__mocks__/react-native-bootsplash).
const hideMock = BootSplash.hide as jest.Mock;

/**
 * Test helper: throws on render the first time, then renders its children once
 * `shouldThrow` flips to false. Used to verify reset remounts a healthy tree.
 */
function Boom({
  shouldThrow,
  message = 'kaboom',
}: {
  shouldThrow: boolean;
  message?: string;
}) {
  if (shouldThrow) {
    throw new Error(message);
  }
  return <Text>healthy child</Text>;
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockedLoggerError.mockClear();
    hideMock.mockClear();
    // React logs caught render errors via console.error; silence it so the
    // expected failure does not pollute the test output.
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children normally when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('healthy child')).toBeTruthy();
  });

  it('renders the default ErrorFallback when a child throws (no crash)', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('hides the native bootsplash when a child throws on first render', () => {
    // Regression (DMY-58): the splash is normally hidden via
    // NavigationContainer.onReady, which never fires if the navigator throws on
    // first render. componentDidCatch must hide it too so the native splash does
    // not sit on top of the fallback forever.
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(hideMock).toHaveBeenCalledTimes(1);
    expect(hideMock).toHaveBeenCalledWith({ fade: true });
  });

  it('logs the error and component stack via logger.error (not console)', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow message="secret-token=abc123" />
      </ErrorBoundary>,
    );

    expect(mockedLoggerError).toHaveBeenCalledTimes(1);
    const [label, error, info] = mockedLoggerError.mock.calls[0];
    expect(label).toBe('ErrorBoundary caught an error');
    expect(error).toBeInstanceOf(Error);
    expect(info).toHaveProperty('componentStack');
    // Redaction is owned & unit-tested by the logger; here we only assert the
    // payload is handed to logger.error (which redacts) rather than console.
  });

  it('resets error state and remounts children on Try again', () => {
    // A mutable holder read at render time so the same child element can stop
    // throwing once we flip it, mirroring a transient runtime error clearing.
    const control = { shouldThrow: true };

    function ControlledBoom() {
      if (control.shouldThrow) {
        throw new Error('kaboom');
      }
      return <Text>healthy child</Text>;
    }

    render(
      <ErrorBoundary>
        <ControlledBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    // Underlying condition clears, then the user taps "Try again": reset()
    // flips hasError off and the subtree remounts healthy.
    control.shouldThrow = false;
    fireEvent.press(screen.getByRole('button'));

    expect(screen.getByText('healthy child')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('renders a custom fallback when the fallback prop is provided', () => {
    const fallback = (reset: () => void) => (
      <TouchableOpacity accessibilityRole="button" onPress={reset}>
        <Text>custom fallback</Text>
      </TouchableOpacity>
    );

    render(
      <ErrorBoundary fallback={fallback}>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('custom fallback')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });
});
