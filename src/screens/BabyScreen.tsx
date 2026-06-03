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
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import BatteryIndicator from '../components/BatteryIndicator';
import OfflineIndicator from '../components/OfflineIndicator';
import { useTheme } from '../hooks/useTheme';
import { PowerSaverIndicator, usePowerSaver } from '../features/powersaver';
import BabyPairingScreen from '../features/pairing/screens/BabyPairingScreen';
import ConnectedParentsList from '../features/webrtc/ConnectedParentsList';
import { useBabyBroadcast } from '../features/webrtc/useBabyBroadcast';
import type { MultiClientSignalingTransport } from '../features/webrtc/babyBroadcast';
import { createNativeBroadcastTransport } from '../features/webrtc/signalingServerNative';
import type { RootStackScreenProps } from '../navigation/types';
import { useAppStore } from '../store/useAppStore';

/**
 * Extra (non-navigation) props for the baby-unit screen. The multi-client
 * broadcast transport (DMY-66) is INJECTED here: production passes the real
 * local-network accept loop once it exists (device milestone DMY-72); with none
 * the fan-out hook stays inert and the viewer list simply shows zero. Tests
 * inject a fake.
 */
export interface BabyScreenProps extends RootStackScreenProps<'Baby'> {
  /** The multi-client broadcast accept loop (DMY-72 seam). Omit to stay inert. */
  readonly broadcastTransport?: MultiClientSignalingTransport;
}

function BabyScreen({ broadcastTransport }: BabyScreenProps) {
  // Night/AOD palette for the baby-unit face (matches the indicator).
  const theme = useTheme('dark');

  // Honest "active session" flag: engaged the moment we leave `idle`. Swap this
  // for the real live-media state when WebRTC lands (DMY-16/18).
  const sessionActive = useAppStore(s => s.connectionStatus !== 'idle');
  const pairedSessionId = useAppStore(s => s.pairedSessionId);

  const { active } = usePowerSaver({ active: sessionActive });

  // Fan-out to multiple parents (DMY-66): the manager shares ONE capture across
  // up to MAX_PARENTS peer connections. The multi-client accept loop is now the
  // REAL native WebSocket SERVER (DMY-72): once paired, we build a native
  // listener that validates the shared secret (the ephemeral sessionId from the
  // QR payload, DMY-6) on each parent's upgrade. An explicitly injected
  // `broadcastTransport` (tests / future flavours) takes precedence; on a build
  // where the native module is absent (Jest) the factory returns `undefined` and
  // the hook stays inert — the list simply shows zero, exactly as before.
  const nativeTransport = useMemo<MultiClientSignalingTransport | undefined>(
    () =>
      broadcastTransport ??
      (pairedSessionId
        ? createNativeBroadcastTransport({ sessionId: pairedSessionId })
        : undefined),
    [broadcastTransport, pairedSessionId],
  );

  const { parents, maxParents, capReached } = useBabyBroadcast(
    nativeTransport ? { transport: nativeTransport } : {},
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      {/* Top banner; dark palette to match the baby-unit face (DMY-60). */}
      <OfflineIndicator mode="dark" />
      <BabyPairingScreen />
      <View
        style={[
          styles.footer,
          { padding: theme.spacing.lg, gap: theme.spacing.lg },
        ]}
      >
        {/* Connected parents (count + status) for the baby unit (DMY-66). */}
        <ConnectedParentsList
          parents={parents}
          maxParents={maxParents}
          capReached={capReached}
          mode="dark"
        />
        {/* Battery level + low-battery warning for the baby unit (DMY-54). */}
        <BatteryIndicator mode="dark" />
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
