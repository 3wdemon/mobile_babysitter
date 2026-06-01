/**
 * usePermissions — thin, testable abstraction over `react-native-permissions`
 * (DMY-42).
 *
 * Why a wrapper rather than calling the library directly from screens:
 *  - Screens/tests speak our domain vocabulary ({@link AppPermission} /
 *    {@link PermissionStatus}) instead of the library's platform-specific
 *    permission ids and result codes.
 *  - The native module is isolated behind one seam, so a single Jest mock of
 *    this hook (or of `react-native-permissions`) covers the whole flow, and a
 *    future swap to bare `PermissionsAndroid`/iOS bridges would not touch any
 *    screen.
 *  - Notifications are requested via the dedicated `requestNotifications`
 *    API (it has no plain `PERMISSIONS` entry on iOS), while camera/microphone
 *    go through `requestMultiple`; this hook hides that asymmetry.
 *
 * The hook deliberately keeps NO long-lived "did the user ever respond" state
 * of its own — completion is tracked by the store's `onboardingCompleted`. It
 * exposes the latest in-memory statuses plus a `request()` action, so a denied
 * or blocked result can be surfaced without blocking the flow.
 */
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import {
  PERMISSIONS,
  RESULTS,
  requestMultiple,
  requestNotifications,
  type Permission,
  type PermissionStatus as RNPermissionStatus,
} from 'react-native-permissions';

import { logger } from '../../services/logger';
import type {
  AppPermission,
  PermissionStatus,
  PermissionStatuses,
} from './types';

/** Initial "not yet asked" status for every permission. */
const INITIAL_STATUSES: PermissionStatuses = {
  camera: 'denied',
  microphone: 'denied',
  notifications: 'denied',
};

/**
 * Resolve our domain {@link AppPermission} to the platform-specific
 * `react-native-permissions` identifier. Notifications are handled separately
 * (see {@link requestNotifications}) so they are not part of this map.
 */
function nativePermissionFor(
  permission: Exclude<AppPermission, 'notifications'>,
): Permission {
  if (Platform.OS === 'ios') {
    return permission === 'camera'
      ? PERMISSIONS.IOS.CAMERA
      : PERMISSIONS.IOS.MICROPHONE;
  }
  return permission === 'camera'
    ? PERMISSIONS.ANDROID.CAMERA
    : PERMISSIONS.ANDROID.RECORD_AUDIO;
}

/** Collapse the library's RESULTS union into our coarser {@link PermissionStatus}. */
function normaliseStatus(result: RNPermissionStatus): PermissionStatus {
  // `limited` (e.g. provisional notifications) is treated as usable -> granted.
  if (result === RESULTS.GRANTED || result === RESULTS.LIMITED) {
    return 'granted';
  }
  if (result === RESULTS.BLOCKED) {
    return 'blocked';
  }
  if (result === RESULTS.UNAVAILABLE) {
    return 'unavailable';
  }
  // RESULTS.DENIED and any unexpected value -> denied (re-requestable).
  return 'denied';
}

/** Return value of {@link usePermissions}. */
export interface UsePermissions {
  /** Latest known status for each permission (in-memory, per session). */
  statuses: PermissionStatuses;
  /** True while a request round-trip is in flight. */
  requesting: boolean;
  /**
   * Request camera, microphone and notification permissions. Resolves with the
   * resulting statuses. NEVER throws: a native failure is logged and treated as
   * `denied` so the onboarding flow can always continue.
   */
  request: () => Promise<PermissionStatuses>;
}

/**
 * Hook exposing the current permission statuses and a `request()` action.
 */
export function usePermissions(): UsePermissions {
  const [statuses, setStatuses] = useState<PermissionStatuses>(INITIAL_STATUSES);
  const [requesting, setRequesting] = useState(false);

  const request = useCallback(async (): Promise<PermissionStatuses> => {
    setRequesting(true);
    try {
      const cameraPerm = nativePermissionFor('camera');
      const microphonePerm = nativePermissionFor('microphone');

      const [multi, notif] = await Promise.all([
        requestMultiple([cameraPerm, microphonePerm]),
        requestNotifications(['alert', 'sound', 'badge']),
      ]);

      const next: PermissionStatuses = {
        camera: normaliseStatus(multi[cameraPerm]),
        microphone: normaliseStatus(multi[microphonePerm]),
        notifications: normaliseStatus(notif.status),
      };
      setStatuses(next);
      return next;
    } catch (error) {
      // Privacy-first + resilience: a permission failure must never break the
      // onboarding flow. Log (redacted) and fall back to "denied" so the user
      // can still proceed and grant later from Settings.
      logger.warn('usePermissions: permission request failed', error);
      const fallback: PermissionStatuses = {
        camera: 'denied',
        microphone: 'denied',
        notifications: 'denied',
      };
      setStatuses(fallback);
      return fallback;
    } finally {
      setRequesting(false);
    }
  }, []);

  return { statuses, requesting, request };
}
