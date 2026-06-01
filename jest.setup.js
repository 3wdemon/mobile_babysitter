/* eslint-env jest */
/**
 * Global Jest setup.
 *
 * Navigation depends on react-native-safe-area-context and
 * react-native-screens, which assume a native host. We swap in compatible
 * mocks so the navigation tree mounts synchronously in the test renderer.
 */

// safe-area-context mock. Mirrors the library's own jest mock but inlined here
// (its shipped mock is ESM/TSX under jest/ and is not covered by our Babel
// transform allowlist). Crucially we reuse the REAL Context objects via
// requireActual so @react-navigation/elements' SafeAreaProviderCompat — which
// reads SafeAreaInsetsContext directly — resolves correctly.
jest.mock('react-native-safe-area-context', () => {
  // require() inside the factory: jest.mock factories may not close over
  // out-of-scope variables.
  const React = require('react');
  const actual = jest.requireActual('react-native-safe-area-context');
  const metrics = {
    frame: { width: 390, height: 844, x: 0, y: 0 },
    insets: { top: 47, right: 0, bottom: 34, left: 0 },
  };

  return {
    ...actual,
    initialWindowMetrics: metrics,
    useSafeAreaInsets: () =>
      React.useContext(actual.SafeAreaInsetsContext) ?? metrics.insets,
    useSafeAreaFrame: () =>
      React.useContext(actual.SafeAreaFrameContext) ?? metrics.frame,
    SafeAreaProvider: ({ children, initialMetrics }) =>
      React.createElement(
        actual.SafeAreaFrameContext.Provider,
        { value: initialMetrics?.frame ?? metrics.frame },
        React.createElement(
          actual.SafeAreaInsetsContext.Provider,
          { value: initialMetrics?.insets ?? metrics.insets },
          children,
        ),
      ),
  };
});

// react-native-screens renders native-backed screen containers. Disabling
// screens makes the navigator fall back to plain RN views in tests.
jest.mock('react-native-screens', () => {
  const actual = jest.requireActual('react-native-screens');
  return {
    ...actual,
    enableScreens: jest.fn(),
  };
});
