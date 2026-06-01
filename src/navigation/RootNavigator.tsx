/**
 * RootNavigator — the app's root native stack.
 *
 * Wires the skeleton screens (DMY-35) into a typed `createNativeStackNavigator`
 * keyed off {@link RootStackParamList}. The initial route is `Pairing`: on
 * launch the user has not yet chosen a role (baby vs parent), so the
 * mode-selection / pairing screen is the natural entry point. Header titles
 * use the route names for now; per-screen header config lands with the real
 * flows.
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import BabyScreen from '../screens/BabyScreen';
import ParentScreen from '../screens/ParentScreen';
import PairingScreen from '../screens/PairingScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Pairing">
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
