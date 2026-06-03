import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * E2E: onboarding welcome -> role-select (DMY-67).
 *
 * TARGET / MECHANISM (important context — see also the harness header):
 * Mobile Babysitter is a BARE React Native app with NO react-native-web build
 * and no web entry. The Playwright skeleton (DMY-39) only wired the runner +
 * config (env-placeholder `baseURL`, a self-contained smoke test, no
 * webServer). It established no real web render target for app screens.
 *
 * Standing up a full RN-web target is out of scope for this 2pt task and would
 * invent a new web stack (forbidden by CLAUDE.md). So — per the task's honest
 * option (b) — these specs drive `tests/e2e/fixtures/onboarding-harness.html`,
 * a self-contained DOM reconstruction of the flow that is kept 1:1 with the RN
 * screens on the parts that matter for an e2e contract:
 *   - step order Welcome -> Permissions -> RoleSelect (= OnboardingNavigator),
 *   - the REAL user-facing copy, fetched at runtime from the same
 *     locales/en.json the app ships (so copy can't silently drift),
 *   - the permission seam from usePermissions.request(): an injectable,
 *     non-blocking resolver that NEVER touches a real native/browser
 *     permission API and never prompts.
 *
 * KNOWN GAP: this exercises the flow's structure + copy + permission/role
 * contract, not the compiled RN components (no RN-web target exists to mount
 * them). The full-fidelity component coverage of this exact flow lives in the
 * Jest integration suite (src/features/onboarding/__tests__/onboardingFlow.
 * test.tsx) via React Native Testing Library, where the same Welcome ->
 * Permissions -> RoleSelect path and both role completions are asserted
 * against the real screens with react-native-permissions mocked. When a real
 * RN-web (or Detox) target lands, re-point these scenarios at it — the DOM
 * contract (testids, step order, permission seam, completion signal) is
 * intentionally migration-friendly.
 *
 * HOW PERMISSIONS ARE MOCKED: the harness exposes window.__setPermissionResolver
 * so each test injects a deterministic statuses map. No real permission prompt
 * can fire, so CI runs are flake-free regardless of the headless browser's
 * permission policy.
 */

// Playwright transpiles specs to CommonJS, so `__dirname` is available at
// runtime — anchor fixture paths to it rather than ESM `import.meta`.
const HARNESS = path.join(__dirname, 'fixtures', 'onboarding-harness.html');
const CATALOG = path.join(__dirname, '..', '..', 'locales', 'en.json');

// Real shipped copy — assertions read from the same catalog the harness loads,
// so the test verifies the actual user-facing strings, not a private copy.
const en = JSON.parse(readFileSync(CATALOG, 'utf8')) as {
  onboarding: {
    welcome: { title: string; continue: string };
    permissions: {
      title: string;
      allowAccess: string;
      continue: string;
      skip: string;
      status: Record<string, string>;
    };
    roleSelect: { title: string; options: Record<string, { title: string }> };
  };
};
const ob = en.onboarding;

// Both files are read from disk in Node — no dev server / webServer / network,
// so the run is fully self-contained and deterministic. The REAL locales/en.json
// is inlined into the harness (replacing the __CATALOG_JSON__ placeholder) so the
// page renders the actual shipped copy without any fetch.
const catalogRaw = readFileSync(CATALOG, 'utf8');
const harnessHtml = readFileSync(HARNESS, 'utf8').replaceAll(
  '__CATALOG_JSON__',
  // Escape `<` so a stray "</script>" in copy can't break out of the tag.
  // replaceAll (not replace) so any mention of the token elsewhere — e.g. in a
  // harness comment — can never shadow the real assignment.
  catalogRaw.replace(/</g, '\\u003c'),
);

test.beforeEach(async ({ page }) => {
  await page.setContent(harnessHtml, { waitUntil: 'load' });
  // Fresh app state lands on Welcome.
  await expect(page.getByTestId('onboarding-root')).toHaveAttribute(
    'data-step',
    'welcome',
  );
});

test.describe('onboarding flow', () => {
  test('AC1: welcome -> permissions -> role-select renders + advances each step', async ({
    page,
  }) => {
    const root = page.getByTestId('onboarding-root');

    // Welcome step renders with the real title + continue copy.
    await expect(page.getByTestId('welcome-title')).toHaveText(
      ob.welcome.title,
    );
    await expect(page.getByTestId('welcome-continue')).toHaveText(
      ob.welcome.continue,
    );

    // Advance: Welcome -> Permissions.
    await page.getByTestId('welcome-continue').click();
    await expect(root).toHaveAttribute('data-step', 'permissions');
    await expect(page.getByTestId('permissions-title')).toHaveText(
      ob.permissions.title,
    );

    // Drive the (mocked) permission request, then advance to role select.
    await page.getByTestId('permissions-allow').click();
    await expect(page.getByTestId('permissions-continue')).toHaveText(
      ob.permissions.continue,
    );
    await page.getByTestId('permissions-continue').click();

    // Role-select step renders.
    await expect(root).toHaveAttribute('data-step', 'role-select');
    await expect(page.getByTestId('role-select-title')).toHaveText(
      ob.roleSelect.title,
    );
    await expect(page.getByTestId('role-option-baby')).toHaveText(
      ob.roleSelect.options.baby.title,
    );
    await expect(page.getByTestId('role-option-parent')).toHaveText(
      ob.roleSelect.options.parent.title,
    );
  });

  test('AC1: permissions request uses the mocked seam (no real prompt) and reflects granted statuses', async ({
    page,
  }) => {
    // Inject a deterministic resolver — proves no real native/browser
    // permission API is involved.
    await page.evaluate(() => {
      window.__setPermissionResolver(() => ({
        camera: 'granted',
        microphone: 'granted',
        notifications: 'granted',
      }));
    });

    await page.getByTestId('welcome-continue').click();
    await page.getByTestId('permissions-allow').click();

    // Inline per-permission status reflects the mocked grant.
    for (const k of ['camera', 'microphone', 'notifications'] as const) {
      await expect(page.getByTestId(`permission-status-${k}`)).toHaveText(
        ob.permissions.status.granted,
      );
    }
    // The seam was driven exactly once.
    const requests = await page.evaluate(() => window.__permissionRequests);
    expect(requests).toHaveLength(1);
  });

  test('AC1: denied permissions still let the flow advance (non-blocking)', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__setPermissionResolver(() => ({
        camera: 'denied',
        microphone: 'denied',
        notifications: 'blocked',
      }));
    });

    await page.getByTestId('welcome-continue').click();
    await page.getByTestId('permissions-allow').click();

    await expect(page.getByTestId('permission-status-camera')).toHaveText(
      ob.permissions.status.denied,
    );
    await expect(
      page.getByTestId('permission-status-notifications'),
    ).toHaveText(ob.permissions.status.blocked);

    // Continue still advances despite denials.
    await page.getByTestId('permissions-continue').click();
    await expect(page.getByTestId('onboarding-root')).toHaveAttribute(
      'data-step',
      'role-select',
    );
  });

  test('AC1: permissions can be skipped without requesting and still reach role-select', async ({
    page,
  }) => {
    await page.getByTestId('welcome-continue').click();
    await page.getByTestId('permissions-skip').click();

    await expect(page.getByTestId('onboarding-root')).toHaveAttribute(
      'data-step',
      'role-select',
    );
    const requests = await page.evaluate(() => window.__permissionRequests);
    expect(requests).toHaveLength(0);
  });

  for (const role of ['parent', 'baby'] as const) {
    test(`AC2: selecting '${role}' reflects the role and completes onboarding`, async ({
      page,
    }) => {
      const root = page.getByTestId('onboarding-root');

      await page.getByTestId('welcome-continue').click();
      await page.getByTestId('permissions-allow').click();
      await page.getByTestId('permissions-continue').click();
      await expect(root).toHaveAttribute('data-step', 'role-select');

      await page.getByTestId(`role-option-${role}`).click();

      // Role reflected + onboarding completed (analog of store.role /
      // onboardingCompleted).
      await expect(root).toHaveAttribute('data-onboarding-complete', 'true');
      await expect(root).toHaveAttribute('data-role', role);
      const state = await page.evaluate(() => window.__onboardingState);
      expect(state).toEqual({ role, onboardingCompleted: true });
    });
  }
});
