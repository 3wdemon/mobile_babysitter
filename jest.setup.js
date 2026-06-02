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

// react-native-permissions (DMY-42) is a native TurboModule with no JS
// fallback. Use the manual mock in __mocks__/react-native-permissions.ts so any
// test that mounts the onboarding flow gets a working, overridable stub.
jest.mock('react-native-permissions');

// react-native-qrcode-svg (DMY-6) renders through react-native-svg, a native
// module with no JS fallback under Jest. Use the manual mock in
// __mocks__/react-native-qrcode-svg.tsx so the baby-unit pairing screen mounts
// and exposes the encoded value for assertions.
jest.mock('react-native-qrcode-svg');

// react-native-vision-camera (DMY-14) is a native Nitro module (camera session,
// preview, QR object scanner) with no JS fallback under Jest. Use the manual
// mock in __mocks__/react-native-vision-camera.tsx so the parent pairing screen
// mounts and tests can drive scans via its `__emitScan` helper.
jest.mock('react-native-vision-camera');

// react-native-biometrics (DMY-10) is a native module with no JS fallback under
// Jest. Use the manual mock in __mocks__/react-native-biometrics.ts so the auth
// flow mounts and tests can drive sensor availability / prompt outcomes.
jest.mock('react-native-biometrics');

// react-native-keychain (DMY-10) bridges to the iOS Keychain / Android Keystore
// with no JS fallback under Jest. Use the manual mock in
// __mocks__/react-native-keychain.ts (in-memory generic-password store) so the
// PIN service persists/verifies and tests can assert nothing plaintext is stored.
jest.mock('react-native-keychain');

// react-native-zeroconf (DMY-7) bridges to a native NSD/DNSSD mDNS module with
// no JS fallback under Jest. Use the manual mock in
// __mocks__/react-native-zeroconf.ts (inert spies) so the pairing screens —
// which build the real zeroconf adapter — mount without touching native code.
// Discovery unit tests inject a fake ZeroconfBackend directly.
jest.mock('react-native-zeroconf');

// react-native-webrtc (DMY-16) is a native module (RTCPeerConnection etc.) with
// no JS fallback under Jest. Use the manual mock in
// __mocks__/react-native-webrtc.ts (a controllable fake RTCPeerConnection) so the
// peer-connection wrapper can be exercised. Most signalling tests inject a mock
// PeerConnection / ctor directly through the PeerConnectionFactory seam.
jest.mock('react-native-webrtc');

// react-native-bootsplash (DMY-58) bridges to the native iOS storyboard /
// Android SplashScreen window with no JS fallback under Jest. Use the manual
// mock in __mocks__/react-native-bootsplash.ts (inert spies) so any test that
// mounts <App /> — which hides the placeholder splash on navigator-ready —
// runs without touching native code.
jest.mock('react-native-bootsplash');
