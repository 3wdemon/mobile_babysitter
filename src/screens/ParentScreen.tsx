/**
 * ParentScreen — parent unit (monitoring side).
 *
 * Skeleton route for DMY-35. The first concrete step is QR pairing (DMY-14):
 * this screen renders the parent-unit pairing view that scans the baby unit's
 * QR code and records the paired session. Remote stream playback, alerts and
 * the rest of the monitoring UI arrive in later issues (DMY-16/17/18).
 *
 * DMY-10: the monitoring UI is wrapped in {@link ParentModeGate}, which puts a
 * biometric/PIN lock in front of it when `settings.biometricLockEnabled` is on.
 * When the setting is off (the default), the gate is a transparent pass-through
 * and behaviour is unchanged.
 */
import { StyleSheet, View } from 'react-native';

import OfflineIndicator from '../components/OfflineIndicator';
import ParentModeGate from '../features/auth/ParentModeGate';
import ParentPairingScreen from '../features/pairing/screens/ParentPairingScreen';
import type { RootStackScreenProps } from '../navigation/types';

function ParentScreen(_props: RootStackScreenProps<'Parent'>) {
  return (
    <ParentModeGate>
      <View style={styles.root}>
        {/* Top banner; renders nothing while online (DMY-60). */}
        <OfflineIndicator />
        <View style={styles.body}>
          <ParentPairingScreen />
        </View>
      </View>
    </ParentModeGate>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
});

export default ParentScreen;
