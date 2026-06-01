import { expect, test } from '@playwright/test';

/**
 * Smoke test for the Playwright skeleton (DMY-39).
 *
 * Intentionally self-contained: it does not touch the app, any screen, or a
 * dev server, so it stays green in CI without booting anything and without a
 * browser binary. It exists to prove the runner, config, and `e2e:web` script
 * are wired correctly. Real, browser-driven scenarios arrive with the first
 * web view.
 */
test.describe('Playwright skeleton', () => {
  test('runner is wired up', () => {
    expect(1 + 1).toBe(2);
  });

  test('expect API behaves as configured', () => {
    // Sanity check that the Playwright `expect` matchers are loaded and the
    // runner reports failures correctly when assertions hold.
    expect('mobile-babysitter').toMatch(/babysitter/);
    expect([1, 2, 3]).toHaveLength(3);
  });
});
