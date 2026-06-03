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

  // Publishing the baby's audio+video is NOT done here. DMY-45 originally wired a
  // 1:1 useMediaSession responder onto this screen, but DMY-66 introduced the
  // fan-out manager (one baby → up to MAX_PARENTS parents over ONE shared
  // capture). With the native listener now live (DMY-72), keeping BOTH paths
  // would open the camera+mic TWICE on the baby (two getUserMedia racing for the
  // camera). DMY-75 unifies the baby publish path: the fan-out manager
  // (useBabyBroadcast, mounted by BabyScreen) is the SOLE publisher — it subsumes
  // the 1:1 case (a single connected parent is just N=1). This screen is now a
  // pure pairing view (QR + LAN advertisement). The parent side still uses the
  // 1:1 useMediaSession as the dial INITIATOR — that path is untouched.

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
