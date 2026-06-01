/**
 * RootNavigator — the app's root native stack.
 *
 * Gating (DMY-42): the root tree is driven by the persisted `onboardingCompleted`
 * flag in the app store.
 *  - onboardingCompleted === false -> mount the onboarding flow
 *    (Welcome -> Permissions -> RoleSelect). Completing RoleSelect flips the
 *    flag, which re-renders this navigator and unmounts onboarding.
 *  - onboardingCompleted === true  -> mount the main flow. The initial route is
 *    chosen from the persisted `role`: `baby` -> Baby, `parent` -> Parent, and
 *    the Pairing screen otherwise (role still unset, e.g. legacy state).
 *
 * Conditionally rendering different `Stack.Screen` sets (rather than navigating
 * imperatively) is the React Navigation auth-flow pattern: it guarantees the
 * onboarding routes are not reachable once complete, and vice versa.
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import OnboardingNavigator from '../features/onboarding/OnboardingNavigator';
import { useAppStore } from '../store/useAppStore';
import BabyScreen from '../screens/BabyScreen';
import ParentScreen from '../screens/ParentScreen';
import PairingScreen from '../screens/PairingScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  const onboardingCompleted = useAppStore(s => s.onboardingCompleted);
  const role = useAppStore(s => s.role);

  if (!onboardingCompleted) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
      </Stack.Navigator>
    );
  }

  // Onboarding done: open the screen matching the persisted role. Fall back to
  // Pairing if a role was never recorded.
  const initialRouteName: keyof RootStackParamList =
    role === 'baby' ? 'Baby' : role === 'parent' ? 'Parent' : 'Pairing';

  return (
    <Stack.Navigator initialRouteName={initialRouteName}>
      <Stack.Screen
        name="Pairing"
        component={PairingScreen}
        options={{ title: 'Mobile Babysitter' }}
      />
      <Stack.Screen
        name="Baby"
        component={BabyScreen}
        options={{ title: 'Baby unit' }}
      />
      <Stack.Screen
        name="Parent"
        component={ParentScreen}
        options={{ title: 'Parent unit' }}
      />
    </Stack.Navigator>
  );
}

export default RootNavigator;
