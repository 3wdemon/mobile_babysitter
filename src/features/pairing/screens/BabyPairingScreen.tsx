/**
 * BabyPairingScreen — the baby-unit QR-pairing view (DMY-6).
 *
 * The baby phone shows a QR code that encodes the local pairing payload
 * (session id + extensible WebRTC connection placeholder). The parent phone
 * scans it (DMY-7) and bootstraps the local WebRTC handshake (DMY-16/18). No
 * cloud account is involved — everything needed to connect is in the QR.
 *
 * All colours/typography/spacing come from design tokens via `useTheme`; no
 * raw hex values are hard-coded. The serialized QR string is NEVER rendered as
 * text or logged (it is connection material), only fed to the QR encoder.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useTheme } from '../../../hooks/useTheme';
import { useMediaSession } from '../../webrtc/useMediaSession';
import { useSignalingTransport } from '../../webrtc/useSignalingTransport';
import { usePublishService } from '../discovery/useDiscovery';
import { usePairingSession } from '../usePairingSession';

/** Fixed QR module size in dp; large enough to scan comfortably across a room. */
const QR_SIZE = 240;

function BabyPairingScreen() {
  const theme = useTheme();
  const { payload, qrValue, regenerate } = usePairingSession();

  // mDNS/Bonjour: advertise this baby-unit on the LAN so a parent on the same
  // Wi-Fi can find it WITHOUT scanning the QR (DMY-7). The advertisement
  // carries only the ephemeral session id + version (no PII). Re-advertises
  // when "New code" mints a fresh session; withdraws on unmount.
  const { publishing } = usePublishService({ sessionId: payload.sessionId });

  // DMY-45: the baby is the signalling RESPONDER — it must LISTEN for the
  // parent's dial. React Native has no JS WebSocket server, so the listen
  // transport is the native seam (SignalingServerFactory); the shipped default
  // throws → no transport → the media session stays inert until the native
  // listener lands (the remaining device milestone). Wiring it here means the
  // baby publishes audio+video over a SINGLE peer connection the instant the
  // listener exists — no further screen changes needed. The session auto-starts
  // from the paired state in useSignaling (driven by the live peer events).
  const transport = useSignalingTransport();
  useMediaSession({ transport });

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text
        accessibilityRole="header"
        style={[
          styles.title,
          {
            color: theme.colors.text,
            fontSize: theme.typography.fontSizes.xl,
            fontWeight: theme.typography.fontWeights.bold,
            lineHeight: theme.typography.lineHeights.xl,
            marginBottom: theme.spacing.sm,
          },
        ]}>
        Pair this baby unit
      </Text>

      <Text
        style={[
          styles.subtitle,
          {
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.md,
            lineHeight: theme.typography.lineHeights.md,
            marginBottom: theme.spacing.xl,
          },
        ]}>
        Scan this code with the parent phone. Nothing leaves your devices.
      </Text>

      <View
        testID="pairing-qr"
        style={[
          styles.qrFrame,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.spacing.md,
            padding: theme.spacing.lg,
          },
        ]}>
        <QRCode
          value={qrValue}
          size={QR_SIZE}
          backgroundColor={theme.colors.surface}
          color={theme.colors.text}
        />
      </View>

      <Text
        testID="network-visibility"
        style={[
          styles.networkStatus,
          {
            color: publishing ? theme.colors.success : theme.colors.textMuted,
            fontSize: theme.typography.fontSizes.sm,
            lineHeight: theme.typography.lineHeights.sm,
            marginTop: theme.spacing.lg,
          },
        ]}>
        {publishing
          ? 'Visible on your Wi-Fi — the parent phone can find this unit without scanning.'
          : 'Show the code above to pair.'}
      </Text>

      <TouchableOpacity
        accessibilityRole="button"
        style={[
          styles.button,
          {
            backgroundColor: theme.colors.primary,
            borderRadius: theme.spacing.sm,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.xl,
            marginTop: theme.spacing.xl,
          },
        ]}
        onPress={regenerate}>
        <Text
          style={[
            styles.buttonLabel,
            {
              color: theme.colors.onPrimary,
              fontSize: theme.typography.fontSizes.md,
              fontWeight: theme.typography.fontWeights.semibold,
            },
          ]}>
          New code
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
  },
  networkStatus: {
    textAlign: 'center',
  },
  qrFrame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    alignItems: 'center',
  },
  buttonLabel: {},
});

export default BabyPairingScreen;
