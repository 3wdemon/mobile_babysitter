/**
 * OnboardingNavigator — the nested onboarding stack (DMY-42).
 *
 * Three sequential steps: Welcome -> Permissions -> RoleSelect. This stack is
 * mounted by the RootNavigator only while `onboardingCompleted` is false;
 * completing RoleSelect flips that flag, which unmounts this whole stack and
 * routes to the role-specific screen. Headers are hidden so each step owns its
 * full-bleed layout.
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PermissionsScreen from './screens/PermissionsScreen';
import RoleSelectScreen from './screens/RoleSelectScreen';
import WelcomeScreen from './screens/WelcomeScreen';
import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

function OnboardingNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Welcome"
      screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="Permissions" component={PermissionsScreen} />
      <Stack.Screen name="RoleSelect" component={RoleSelectScreen} />
    </Stack.Navigator>
  );
}

export default OnboardingNavigator;
