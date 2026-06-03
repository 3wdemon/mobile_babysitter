/**
 * ParentPairingScreen — the parent-unit QR-scanning view (DMY-14).
 *
 * The parent phone points its camera at the baby-unit's QR (DMY-6). We decode
 * the code with react-native-vision-camera, validate it
 * ({@link usePairingScanner} -> parse + freshness/connection checks), and on a
 * valid, fresh code record the pairing in the store and show a "paired" state.
 *
 * SCOPE: a successful scan means PAIRED, not CONNECTED. The real WebRTC
 * signalling handshake (offer/answer + ICE) is DMY-16/18. We surface
 * "Paired — connecting soon" honestly and never fake a live media session; the
 * signalling kick-off TODO lives in {@link usePairingScanner}.
 *
 * Permissions: camera access is requested via the project {@link usePermissions}
 * hook (same path as onboarding, DMY-42). If the user has not granted it — or
 * blocked it — we render a graceful explainer with a request / open-Settings
 * affordance instead of a black camera view; nothing crashes.
 *
 * All colours/typography/spacing come from design tokens via `useTheme`.
 */
import { useCallback, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { openSettings } from 'react-native-permissions';
import {
  Camera,
  isScannedCode,
  useCameraDevice,
  useObjectOutput,
  usePreviewOutput,
  type ScannedObject,
  type ScannedObjectType,
} from 'react-native-vision-camera';

import LoadingState from '../../../components/LoadingState';
import { useTheme } from '../../../hooks/useTheme';
import { useTranslation } from '../../../hooks/useTranslation';
import { logger } from '../../../services/logger';
import { useAppStore } from '../../../store/useAppStore';
import ParentMediaView from '../../webrtc/ParentMediaView';
import { useMediaSession } from '../../webrtc/useMediaSession';
import { useSignalingTransport } from '../../webrtc/useSignalingTransport';
import { usePermissions } from '../../onboarding/usePermissions';
import DiscoveredUnitsList from '../discovery/DiscoveredUnitsList';
import { useDiscoveredUnits } from '../discovery/useDiscovery';
import { usePairingScanner } from '../usePairingScanner';
import type { PairingScanRejectReason } from '../types';

/** QR codes only — we are not scanning barcodes/faces. */
const SCAN_TYPES: ScannedObjectType[] = ['qr'];

/** i18n key suffixes for each rejection reason (resolved via `t()` at render). */
const REJECT_KEYS: Record<
  PairingScanRejectReason,
  { title: string; body: string }
> = {
  invalid: {
    title: 'pairing.parent.reject.invalidTitle',
    body: 'pairing.parent.reject.invalidBody',
  },
  stale: {
    title: 'pairing.parent.reject.staleTitle',
    body: 'pairing.parent.reject.staleBody',
  },
};

function ParentPairingScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { statuses, requesting, request } = usePermissions();
  const cameraStatus = statuses.camera;
  const hasCamera = cameraStatus === 'granted';

  const { status, errorReason, onScan, pairWithSessionId, reset } =
    usePairingScanner();

  // Once paired, the signalling layer advances connectionStatus
  // paired -> connecting -> connected (DMY-16/18). While the link is being
  // established we surface the unified loading state instead of an empty
  // media surface.
  const connectionStatus = useAppStore(s => s.connectionStatus);
  const pairedSessionId = useAppStore(s => s.pairedSessionId);
  const connecting =
    connectionStatus === 'paired' || connectionStatus === 'connecting';

  // mDNS/Bonjour local discovery (DMY-7): browse the LAN for baby-units while
  // the scanner is open, as a QR-free alternative on the same Wi-Fi. Gated on
  // camera permission only because the whole pairing view is — discovery itself
  // needs no camera. Tapping a unit pairs via its advertised session id.
  const { units, scanning, settled } = useDiscoveredUnits({
    enabled: hasCamera,
  });

  // DMY-45: dial the paired baby-unit's signalling endpoint. The host/port come
  // from the discovered unit whose advertised sessionId matches what we paired
  // with (mDNS, DMY-7); a QR-only pairing with no resolved endpoint leaves this
  // undefined and the media session stays inert (honest — nothing to dial).
  const endpoint = useMemo(() => {
    if (!pairedSessionId) {
      return null;
    }
    const match = units.find(u => u.sessionId === pairedSessionId);
    return match ? { host: match.host, port: match.port } : null;
  }, [pairedSessionId, units]);

  // The real signalling transport (parent dials over a WebSocket client) +
  // the end-to-end media session. Auto-starts from the paired state inside
  // useSignaling; with no transport the session is inert.
  const transport = useSignalingTransport({ endpoint });
  const media = useMediaSession({ transport });

  const onSelectDiscovered = useCallback(
    (sessionId: string) => {
      pairWithSessionId(sessionId);
    },
    [pairWithSessionId],
  );

  // Back camera; undefined while devices enumerate or on a device with none.
  const device = useCameraDevice('back');

  // Decode QR frames -> hand the string to the (native-free) scanner.
  const onObjectsScanned = useCallback(
    (objects: ScannedObject[]) => {
      for (const object of objects) {
        if (isScannedCode(object) && object.value) {
          onScan(object.value);
          // One valid frame is enough; the scanner locks after a success.
          break;
        }
      }
    },
    [onScan],
  );

  const objectOutput = useObjectOutput({
    types: SCAN_TYPES,
    onObjectsScanned,
  });
  const previewOutput = usePreviewOutput();
  const outputs = useMemo(
    () => [previewOutput, objectOutput],
    [previewOutput, objectOutput],
  );

  const onRequestCamera = useCallback(async () => {
    await request();
  }, [request]);

  const onOpenSettings = useCallback(() => {
    openSettings().catch(error =>
      logger.warn('pairing: failed to open settings', error),
    );
  }, []);

  // Precomputed so the dynamic style below holds no literal style values
  // (keeps react-native/no-inline-styles happy).
  const requestButtonOpacity = requesting ? 0.6 : 1;
  const discoveryStyle = useMemo(
    () => ({ marginTop: theme.spacing.lg }),
    [theme.spacing.lg],
  );
  // Spacing wrapper for the audio-only media view shown in the paired state
  // (DMY-24). Precomputed so the JSX holds no literal style values.
  const mediaViewStyle = useMemo(
    () => ({ width: '100%' as const, marginBottom: theme.spacing.xl }),
    [theme.spacing.xl],
  );

  // --- Permission gate -------------------------------------------------------
  if (!hasCamera) {
    const blocked = cameraStatus === 'blocked';
    return (
      <View
        testID="parent-pairing"
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
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
          ]}
        >
          {t('pairing.parent.permission.title')}
        </Text>
        <Text
          style={[
            styles.body,
            {
              color: theme.colors.textMuted,
              fontSize: theme.typography.fontSizes.md,
              lineHeight: theme.typography.lineHeights.md,
              marginBottom: theme.spacing.xl,
            },
          ]}
        >
          {blocked
            ? t('pairing.parent.permission.blockedBody')
            : t('pairing.parent.permission.deniedBody')}
        </Text>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={
            blocked
              ? t('pairing.parent.permission.openSettingsA11y')
              : t('pairing.parent.permission.allowCameraA11y')
          }
          accessibilityState={{ disabled: requesting }}
          disabled={requesting}
          testID="camera-permission-action"
          style={[
            styles.button,
            {
              backgroundColor: theme.colors.primary,
              borderRadius: theme.spacing.sm,
              paddingVertical: theme.spacing.md,
              paddingHorizontal: theme.spacing.xl,
              opacity: requestButtonOpacity,
            },
          ]}
          onPress={blocked ? onOpenSettings : onRequestCamera}
        >
          <Text
            style={[
              styles.buttonLabel,
              {
                color: theme.colors.onPrimary,
                fontSize: theme.typography.fontSizes.md,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}
          >
            {blocked
              ? t('pairing.parent.permission.openSettings')
              : requesting
              ? t('pairing.parent.permission.requesting')
              : t('pairing.parent.permission.allowCamera')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Paired ----------------------------------------------------------------
  if (status === 'paired') {
    return (
      <View
        testID="parent-pairing"
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <Text
          accessibilityRole="header"
          style={[
            styles.title,
            {
              color: theme.colors.success,
              fontSize: theme.typography.fontSizes.xl,
              fontWeight: theme.typography.fontWeights.bold,
              lineHeight: theme.typography.lineHeights.xl,
              marginBottom: theme.spacing.sm,
            },
          ]}
        >
          {t('pairing.parent.paired.title')}
        </Text>
        <Text
          testID="paired-status"
          style={[
            styles.body,
            {
              color: theme.colors.textMuted,
              fontSize: theme.typography.fontSizes.md,
              lineHeight: theme.typography.lineHeights.md,
              marginBottom: theme.spacing.xl,
            },
          ]}
        >
          {t('pairing.parent.paired.status')}
        </Text>

        {connecting ? (
          <View style={mediaViewStyle}>
            <LoadingState
              testID="parent-connecting"
              message={t('pairing.parent.paired.connecting')}
            />
          </View>
        ) : null}

        <View style={mediaViewStyle}>
          {/*
           * DMY-45: feed the live remote video URL + the parent has no outgoing
           * video, so no controller here (audio-only pause acts on the baby's
           * sender via its own session). The URL is null until a real video
           * `ontrack` arrives — ParentMediaView shows the honest placeholder.
           */}
          <ParentMediaView remoteStreamUrl={media.remoteStreamUrl} />
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('pairing.parent.paired.scanAgainA11y')}
          testID="scan-again"
          style={[
            styles.buttonOutline,
            {
              borderColor: theme.colors.border,
              borderRadius: theme.spacing.sm,
              paddingVertical: theme.spacing.md,
              paddingHorizontal: theme.spacing.xl,
            },
          ]}
          onPress={reset}
        >
          <Text
            style={[
              styles.buttonLabel,
              {
                color: theme.colors.text,
                fontSize: theme.typography.fontSizes.md,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}
          >
            {t('pairing.parent.paired.scanAgain')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Scanning (+ inline error banner) -------------------------------------
  const rejectKeys = errorReason ? REJECT_KEYS[errorReason] : null;
  const reject = rejectKeys
    ? { title: t(rejectKeys.title), body: t(rejectKeys.body) }
    : null;

  return (
    <View
      testID="parent-pairing"
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      {device ? (
        <Camera
          style={styles.camera}
          device={device}
          isActive
          outputs={outputs}
        />
      ) : (
        <View
          testID="camera-unavailable"
          style={[styles.camera, styles.cameraFallback]}
        >
          <Text
            style={[
              styles.body,
              {
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSizes.md,
                lineHeight: theme.typography.lineHeights.md,
              },
            ]}
          >
            {t('pairing.parent.scan.noCamera')}
          </Text>
        </View>
      )}

      <View
        style={[
          styles.overlay,
          {
            padding: theme.spacing.xl,
            backgroundColor: theme.colors.overlay,
          },
        ]}
      >
        <Text
          accessibilityRole="header"
          style={[
            styles.overlayTitle,
            {
              color: theme.colors.onPrimary,
              fontSize: theme.typography.fontSizes.lg,
              fontWeight: theme.typography.fontWeights.semibold,
              lineHeight: theme.typography.lineHeights.lg,
              marginBottom: theme.spacing.xs,
            },
          ]}
        >
          {reject ? reject.title : t('pairing.parent.scan.title')}
        </Text>
        <Text
          testID={reject ? 'scan-error' : 'scan-hint'}
          style={[
            styles.overlayBody,
            {
              color: theme.colors.onPrimary,
              fontSize: theme.typography.fontSizes.sm,
              lineHeight: theme.typography.lineHeights.sm,
            },
          ]}
        >
          {reject ? reject.body : t('pairing.parent.scan.hint')}
        </Text>

        <View style={discoveryStyle}>
          <DiscoveredUnitsList
            units={units}
            scanning={scanning}
            settled={settled}
            onSelect={onSelectDiscovered}
          />
        </View>
      </View>
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
  camera: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cameraFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  overlayTitle: {},
  overlayBody: {},
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
  },
  buttonOutline: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonLabel: {},
});

export default ParentPairingScreen;
