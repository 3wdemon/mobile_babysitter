module.exports = {
  preset: '@react-native/jest-preset',
  // The RN preset ships ESM-only navigation packages untransformed. Extend the
  // allowlist so Babel transpiles @react-navigation and react-native-screens
  // (and their RN-flavoured deps) for Jest's CommonJS runtime.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens)/)',
  ],
  // Playwright owns tests/e2e (E2E web) and Detox owns tests/detox (E2E native,
  // its own Jest config). Keep the unit runner out of both so the stacks never
  // pick up each other's specs.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/e2e/',
    '<rootDir>/tests/detox/',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
