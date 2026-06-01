module.exports = {
  preset: '@react-native/jest-preset',
  // The RN preset ships ESM-only navigation packages untransformed. Extend the
  // allowlist so Babel transpiles @react-navigation and react-native-screens
  // (and their RN-flavoured deps) for Jest's CommonJS runtime.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
