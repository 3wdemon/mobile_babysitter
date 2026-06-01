/**
 * Onboarding feature types (DMY-42).
 *
 * The onboarding flow is a self-contained nested stack:
 *   Welcome -> Permissions -> RoleSelect
 * mounted by {@link OnboardingNavigator} and gated on the persisted
 * `onboardingCompleted` flag in the app store.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/**
 * The three permissions the baby-monitor requests up front.
 *  - `camera`        — live video of the baby (baby unit).
 *  - `microphone`    — two-way audio + on-device cry detection.
 *  - `notifications` — background cry/motion alerts.
 *
 * This is a domain-level enum intentionally decoupled from the underlying
 * `react-native-permissions` permission identifiers, so screens/tests depend on
 * our vocabulary and the native library stays an implementation detail of
 * {@link usePermissions}.
 */
export type AppPermission = 'camera' | 'microphone' | 'notifications';

/**
 * Normalised permission outcome. Mirrors the meaningful subset of
 * `react-native-permissions` RESULTS, collapsed to what the UI cares about:
 *  - `granted`     — usable now.
 *  - `denied`      — refused but re-requestable.
 *  - `blocked`     — refused permanently; only Settings can change it.
 *  - `unavailable` — feature/permission not present on this device.
 */
export type PermissionStatus = 'granted' | 'denied' | 'blocked' | 'unavailable';

/** Map of every requested permission to its current status. */
export type PermissionStatuses = Record<AppPermission, PermissionStatus>;

/**
 * Onboarding nested-stack routes. No params are passed between steps; the only
 * shared state (chosen role, completion) lives in the app store.
 */
export type OnboardingStackParamList = {
  Welcome: undefined;
  Permissions: undefined;
  RoleSelect: undefined;
};

/** Per-screen props helper for onboarding screens. */
export type OnboardingScreenProps<
  RouteName extends keyof OnboardingStackParamList,
> = NativeStackScreenProps<OnboardingStackParamList, RouteName>;
