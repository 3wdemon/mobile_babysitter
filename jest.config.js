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
  // --- Coverage (DMY-69) --------------------------------------------------
  // Scope coverage to the app's executable source under src/. Without an
  // explicit list Jest only reports files a test happened to import, so the
  // global threshold below would not see untested modules. The app entry
  // (index.js), native build config and the e2e/detox stacks are out of scope
  // for the unit runner.
  // Excluded rows are structurally uncoverable under Jest and carry NO
  // executable logic, so dropping them does not hide real risk:
  //   - **/index.ts barrels: pure re-export surfaces.
  //   - type-only modules: TS interfaces/aliases compile to an empty module —
  //     there is no statement or branch to cover. These are listed
  //     INDIVIDUALLY (not by a `*types.ts` glob) so the type+logic files
  //     (features/pairing/types.ts, features/pairing/discovery/types.ts,
  //     which export real constants + `isKnownPairingVersion` and have their
  //     own tests) STAY measured.
  // Native bridges are deliberately NOT excluded wholesale: the project models
  // them behind injectable backends, so the testable logic stays in coverage.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/store/types.ts',
    '!src/navigation/types.ts',
    '!src/features/onboarding/types.ts',
    '!src/features/detection/types.ts',
    '!src/features/detection/motionTypes.ts',
    '!src/features/powersaver/types.ts',
    '!src/features/webrtc/types.ts',
    '!src/features/webrtc/mediaTypes.ts',
    '!src/features/webrtc/signalingTypes.ts',
    '!src/features/alerts/alertTypes.ts',
  ],
  // CI gate: a coverage run FAILS below these thresholds (CLAUDE.md = 70/70).
  // statements + branches are the AC floor; functions/lines are set to the same
  // floor and sit comfortably above it.
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 70,
      functions: 70,
      lines: 70,
    },
  },
};
