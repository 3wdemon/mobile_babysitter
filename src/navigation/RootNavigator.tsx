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
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

import OnboardingNavigator from '../features/onboarding/OnboardingNavigator';
import { useTranslation } from '../hooks/useTranslation';
import { useAppStore } from '../store/useAppStore';
import BabyScreen from '../screens/BabyScreen';
import ParentScreen from '../screens/ParentScreen';
import PairingScreen from '../screens/PairingScreen';
import AboutScreen from '../screens/AboutScreen';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import SettingsScreen from '../screens/SettingsScreen';
import type { RootStackParamList, RootStackScreenProps } from './types';

/**
 * A header gear button that opens the Settings screen (DMY-52). Rendered as the
 * `headerRight` on the role screens (Baby / Parent) so Settings is reachable
 * from the main flow.
 */
function SettingsHeaderButton({
  navigation,
}: {
  navigation: RootStackScreenProps<'Baby' | 'Parent'>['navigation'];
}) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      testID="header-settings-button"
      accessibilityRole="button"
      accessibilityLabel={t('settings.openA11y')}
      onPress={() => navigation.navigate('Settings')}
    >
      {/* Gear glyph; label provides the accessible name. */}
      <Text style={headerStyles.gear}>⚙︎</Text>
    </TouchableOpacity>
  );
}

/**
 * `headerRight` factory for the role screens. Defined at module scope (rather
 * than inline in `screenOptions`) so it is a stable component reference — the
 * idiomatic React Navigation header pattern.
 */
function renderSettingsHeaderRight(
  navigation: RootStackScreenProps<'Baby' | 'Parent'>['navigation'],
) {
  return <SettingsHeaderButton navigation={navigation} />;
}

const headerStyles = StyleSheet.create({
  gear: {
    fontSize: 20,
  },
});

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
        options={({ navigation }) => ({
          title: 'Baby unit',
          headerRight: () => renderSettingsHeaderRight(navigation),
        })}
      />
      <Stack.Screen
        name="Parent"
        component={ParentScreen}
        options={({ navigation }) => ({
          title: 'Parent unit',
          headerRight: () => renderSettingsHeaderRight(navigation),
        })}
      />
      {/*
       * Legal screens (DMY-64). Registered in the stack so they are reachable
       * programmatically today; the intended entry point lives in Settings,
       * which wires these in via DMY-52.
       */}
      <Stack.Screen
        name="About"
        component={AboutScreen}
        options={{ title: 'About' }}
      />
      <Stack.Screen
        name="PrivacyPolicy"
        component={PrivacyPolicyScreen}
        options={{ title: 'Privacy Policy' }}
      />
      {/* Settings (DMY-52). Reached via the header gear on Baby / Parent. */}
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
    </Stack.Navigator>
  );
}

export default RootNavigator;
