/**
 * BabyScreen — baby unit (camera/mic streaming side).
 *
 * Route for DMY-35. The first concrete step is QR pairing (DMY-6): this screen
 * renders the baby-unit pairing view that shows the QR code the parent phone
 * scans. Streaming, mic capture and the foreground service arrive in later
 * issues (DMY-7/14/17/18).
 *
 * Power-saver (DMY-12): the baby-unit enters a dim, low-power posture during an
 * active monitoring session. The real WebRTC session does not exist yet
 * (DMY-16/18), so "active" is derived HONESTLY from the ephemeral connection
 * status — once the device is past `idle` (paired / connecting / connected) the
 * monitor is considered engaged and power-saver applies (subject to the user
 * setting). The status-only indicator/toggle is shown below the pairing view.
 */
import { ScrollView, StyleSheet, View } from 'react-native';

import OfflineIndicator from '../components/OfflineIndicator';
import { useTheme } from '../hooks/useTheme';
import { PowerSaverIndicator, usePowerSaver } from '../features/powersaver';
import BabyPairingScreen from '../features/pairing/screens/BabyPairingScreen';
import type { RootStackScreenProps } from '../navigation/types';
import { useAppStore } from '../store/useAppStore';

function BabyScreen(_props: RootStackScreenProps<'Baby'>) {
  // Night/AOD palette for the baby-unit face (matches the indicator).
  const theme = useTheme('dark');

  // Honest "active session" flag: engaged the moment we leave `idle`. Swap this
  // for the real live-media state when WebRTC lands (DMY-16/18).
  const sessionActive = useAppStore(s => s.connectionStatus !== 'idle');

  const { active } = usePowerSaver({ active: sessionActive });

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      {/* Top banner; dark palette to match the baby-unit face (DMY-60). */}
      <OfflineIndicator mode="dark" />
      <BabyPairingScreen />
      <View style={[styles.footer, { padding: theme.spacing.lg }]}>
        <PowerSaverIndicator active={active} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  footer: {
    width: '100%',
  },
});

export default BabyScreen;
