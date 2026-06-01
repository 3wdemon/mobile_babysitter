import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Mobile Babysitter web-view E2E tests.
 *
 * This is an infrastructure skeleton (DMY-39). The app currently exposes no
 * web views, so there is no dev server to boot yet and `baseURL` is left as an
 * env-driven placeholder. Real scenarios (and a `webServer` block) land once
 * web views exist.
 *
 * Detox covers native flows separately (DMY-40, tests/detox/) — keep the two
 * suites disjoint.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Fail the build if `test.only` is committed.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Deterministic in CI; let local runs use available cores.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    // No web server yet — supply a target via PLAYWRIGHT_BASE_URL when web
    // views exist. Tests in this skeleton do not depend on it.
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
