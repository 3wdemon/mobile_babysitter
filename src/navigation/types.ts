/**
 * Navigation route contract.
 *
 * `RootStackParamList` is the single source of truth for the root native-stack
 * routes and their params. Screens are typed against it via the
 * `RootStackScreenProps` helper so route names and params are checked at
 * compile time (navigating to an unknown route, or passing the wrong params,
 * is a type error).
 *
 * The concrete screens are skeletons in this issue (DMY-35); the business
 * flows live in DMY-6/7/14/17/18. Params are intentionally `undefined`
 * (no params) for now — extend a route's type here when a flow needs to
 * pass data.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/**
 * Root stack routes. The value is the param object for the route, or
 * `undefined` when the route takes no params.
 */
export type RootStackParamList = {
  /** Onboarding flow (nested stack), shown until onboarding is completed. */
  Onboarding: undefined;
  /** Mode-selection / pairing entry point. */
  Pairing: undefined;
  /** Baby unit (camera/mic streaming side). */
  Baby: undefined;
  /** Parent unit (monitoring side). */
  Parent: undefined;
  /** App info screen (name, version, privacy link) — DMY-64. */
  About: undefined;
  /** Privacy policy (placeholder copy) — DMY-64. */
  PrivacyPolicy: undefined;
};

/**
 * Per-screen props helper. Usage:
 *   function BabyScreen({ navigation, route }: RootStackScreenProps<'Baby'>) {}
 */
export type RootStackScreenProps<RouteName extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, RouteName>;

declare global {
  namespace ReactNavigation {
    // Makes the typed param list the default for `useNavigation()` etc.,
    // so untyped navigation calls are still route-checked.
    interface RootParamList extends RootStackParamList {}
  }
}
