/**
 * Browser-side globals the onboarding harness installs on `window`
 * (tests/e2e/fixtures/onboarding-harness.html). They are referenced inside
 * `page.evaluate` bodies, which execute in the browser context, so they must be
 * declared for the TypeScript program that type-checks the specs.
 */
type HarnessPermissionStatus = 'granted' | 'denied' | 'blocked' | 'unavailable';

type HarnessPermissionStatuses = Record<
  'camera' | 'microphone' | 'notifications',
  HarnessPermissionStatus
>;

interface Window {
  /** Real locales/en.json injected by the spec before the harness runs. */
  __catalog: unknown;
  /** Override the (mocked, non-blocking) permission resolver used by the flow. */
  __setPermissionResolver: (fn: () => HarnessPermissionStatuses) => void;
  /** Records every permission request the flow made (analog of jest call-count). */
  __permissionRequests: HarnessPermissionStatuses[];
  /** Completion signal: analog of the app store's role + onboardingCompleted. */
  __onboardingState: { role: string | null; onboardingCompleted: boolean };
  /** Restart the flow at the Welcome step (fresh app state). */
  __startOnboarding: () => void;
}
