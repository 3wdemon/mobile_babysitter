/** @type {import('jest').Config} */
module.exports = {
  // Dedicated Detox (E2E native) Jest runner. The repo root jest.config.js owns
  // unit tests and ignores this dir; Playwright owns tests/e2e. Keeping a
  // separate config here means `npm test` never picks up native specs (which
  // require a device/emulator + built app to run).
  rootDir: '..',
  testMatch: ['<rootDir>/detox/**/*.test.ts'],
  testTimeout: 120000,
  maxWorkers: 1,
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters: ['detox/runners/jest/reporter'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  setupFilesAfterEnv: ['detox/runners/jest/adapter'],
  verbose: true,
};
