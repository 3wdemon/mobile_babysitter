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

import { useTheme } from '../../../hooks/useTheme';
import { logger } from '../../../services/logger';
import { usePermissions } from '../../onboarding/usePermissions';
import { usePairingScanner } from '../usePairingScanner';
import type { PairingScanRejectReason } from '../types';

/** QR codes only — we are not scanning barcodes/faces. */
const SCAN_TYPES: ScannedObjectType[] = ['qr'];

/** User-facing copy for each rejection reason. */
const REJECT_COPY: Record<
  PairingScanRejectReason,
  { title: string; body: string }
> = {
  invalid: {
    title: 'That code isn’t a pairing code',
    body: 'Point the camera at the QR shown on the baby unit. Other QR codes won’t work.',
  },
  stale: {
    title: 'That code has expired',
    body: 'Tap “New code” on the baby unit to show a fresh one, then scan again.',
  },
};

function ParentPairingScreen() {
  const theme = useTheme();
  const { statuses, requesting, request } = usePermissions();
  const cameraStatus = statuses.camera;
  const hasCamera = cameraStatus === 'granted';

  const { status, errorReason, onScan, reset } = usePairingScanner();

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

  // --- Permission gate -------------------------------------------------------
  if (!hasCamera) {
    const blocked = cameraStatus === 'blocked';
    return (
      <View
        testID="parent-pairing"
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
          Camera access needed
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
          ]}>
          {blocked
            ? 'Camera access is turned off. Enable it in Settings to scan the baby unit’s code. The camera is only used to read the pairing QR.'
            : 'We need the camera to scan the QR code on the baby unit. It’s only used for pairing.'}
        </Text>

        <TouchableOpacity
          accessibilityRole="button"
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
          onPress={blocked ? onOpenSettings : onRequestCamera}>
          <Text
            style={[
              styles.buttonLabel,
              {
                color: theme.colors.onPrimary,
                fontSize: theme.typography.fontSizes.md,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}>
            {blocked
              ? 'Open Settings'
              : requesting
              ? 'Requesting…'
              : 'Allow camera'}
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
        style={[styles.container, { backgroundColor: theme.colors.background }]}>
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
          ]}>
          Paired
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
          ]}>
          Connected to the baby unit. The live audio/video link starts in a
          moment.
        </Text>

        <TouchableOpacity
          accessibilityRole="button"
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
          onPress={reset}>
          <Text
            style={[
              styles.buttonLabel,
              {
                color: theme.colors.text,
                fontSize: theme.typography.fontSizes.md,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}>
            Scan a different unit
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Scanning (+ inline error banner) -------------------------------------
  const reject = errorReason ? REJECT_COPY[errorReason] : null;

  return (
    <View
      testID="parent-pairing"
      style={[styles.container, { backgroundColor: theme.colors.background }]}>
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
          style={[styles.camera, styles.cameraFallback]}>
          <Text
            style={[
              styles.body,
              {
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSizes.md,
                lineHeight: theme.typography.lineHeights.md,
              },
            ]}>
            No camera available on this device.
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
        ]}>
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
          ]}>
          {reject ? reject.title : 'Scan the baby unit'}
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
          ]}>
          {reject
            ? reject.body
            : 'Point the camera at the QR code shown on the baby phone.'}
        </Text>
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
