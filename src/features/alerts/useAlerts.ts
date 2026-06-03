/**
 * useAlerts — wires detection event sources into the {@link AlertService} and
 * exposes React-friendly alert state (DMY-26).
 *
 * Dependency inversion, like the detection hooks: the caller INJECTS an
 * {@link AlertEventSource} that pushes already-reduced {@link AlertType}s (noise
 * from DMY-8, motion/no_motion from DMY-25, cry from DMY-21 once it lands). In
 * production the parent screen adapts the detection `onNoise`/`onMotion`/`onCry`
 * callbacks into this source; tests pass a stub that emits synthetic types. The
 * hook itself knows nothing about microphones, cameras or ML.
 *
 * It reads `settings.alertSoundsEnabled` from the store and feeds it to the
 * service so toggling the setting takes effect live (no re-subscribe needed —
 * the service reads enablement on every event via a ref). On each accepted alert
 * it updates `lastAlert` and invokes the optional `onAlert` callback. The
 * injected {@link AlertSoundPlayer} defaults to the no-op player so the feature
 * is safe before the real audio engine (DMY-9) exists.
 *
 * Privacy: only an {@link AlertEvent} (type + time + soundId) is ever exposed or
 * logged — never a metric, frame, audio buffer or any media.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppStore } from '../../store/useAppStore';
import { logger } from '../../services/logger';
import { createAlertService } from './alertService';
import { noopAlertSoundPlayer } from './alertSoundPlayer';
import { noopNotificationPresenter } from './notificationPresenter';
import type { AlertNotificationPresenter } from './notificationPresenter';
import type {
  AlertEvent,
  AlertSoundPlayer,
  AlertType,
} from './alertTypes';

/**
 * Integration point for detection sources.
 *
 * A source pushes reduced {@link AlertType}s to `onAlertType` and returns an
 * unsubscribe function. Any adapter that turns a `NoiseEvent`/`MotionEvent`/
 * future `CryEvent` into its `type` satisfies this contract. No metric/media
 * crosses this boundary — only the discriminant type.
 */
export type AlertEventSource = (
  onAlertType: (type: AlertType) => void,
) => () => void;

/** Options for {@link useAlerts}. */
export interface UseAlertsOptions {
  /**
   * Detection source. Pushes reduced alert types; returns an unsubscribe fn.
   * When omitted the hook stays idle — useful before sources are wired.
   */
  readonly source?: AlertEventSource;
  /**
   * Sound player. Defaults to the no-op player (real playback is DMY-9).
   * Injected so tests can spy and production can swap in the real engine.
   */
  readonly player?: AlertSoundPlayer;
  /**
   * Local-notification sink (DMY-46). Fires IN PARALLEL to the sound for every
   * RAISED alert, never for dropped/snoozed/throttled ones. Defaults to the
   * no-op presenter; production passes `createNotifeePresenter()`. Injected so
   * tests can spy. A throw/rejection here never breaks the sound or pipeline.
   */
  readonly presenter?: AlertNotificationPresenter;
  /** Called whenever an alert is actually raised (after throttle/priority). */
  readonly onAlert?: (event: AlertEvent) => void;
  /** When `false`, the source is not subscribed. Defaults to `true`. */
  readonly enabled?: boolean;
}

/** Value returned by {@link useAlerts}. */
export interface AlertsState {
  /** The most recently raised alert, or `null`. */
  readonly lastAlert: AlertEvent | null;
}

export function useAlerts(options: UseAlertsOptions = {}): AlertsState {
  const {
    source,
    player = noopAlertSoundPlayer,
    presenter = noopNotificationPresenter,
    onAlert,
    enabled = true,
  } = options;

  const alertSoundsEnabled = useAppStore(s => s.settings.alertSoundsEnabled);
  const [lastAlert, setLastAlert] = useState<AlertEvent | null>(null);

  // Keep the latest enablement / callback in refs so changing them does not
  // tear down and re-create the service or re-subscribe the source.
  const enabledRef = useRef(alertSoundsEnabled);
  enabledRef.current = alertSoundsEnabled;

  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  // Latest presenter in a ref so swapping it does not re-subscribe the source.
  const presenterRef = useRef(presenter);
  presenterRef.current = presenter;

  // One service per player instance. It reads enablement live via the ref.
  const service = useMemo(
    () =>
      createAlertService({
        player,
        isEnabled: () => enabledRef.current,
      }),
    [player],
  );

  const handleType = useCallback(
    (type: AlertType) => {
      // `service.handle` applies ALL policy (enablement / throttle / snooze /
      // priority) and, for a RAISED event, plays the per-type sound. A non-null
      // `event` is exactly the "raised" discriminant — dropped/snoozed/throttled
      // events return `{ event: null }` and never reach the body below.
      const { event } = service.handle(type);
      if (event) {
        setLastAlert(event);
        onAlertRef.current?.(event);
        // SECOND SINK (DMY-46): post a local notification IN PARALLEL to the
        // sound, for raised events ONLY. Isolated so a sync throw OR an async
        // rejection from the presenter can never break the sound or pipeline.
        try {
          const result = presenterRef.current.present(event);
          if (result && typeof result.then === 'function') {
            result.then(undefined, () => {
              logger.warn('alert: notification present rejected', {
                type: event.type,
              });
            });
          }
        } catch {
          logger.warn('alert: notification present threw', {
            type: event.type,
          });
        }
      }
    },
    [service],
  );

  useEffect(() => {
    if (!enabled || !source) {
      return;
    }
    service.reset();
    const unsubscribe = source(handleType);
    return () => {
      unsubscribe();
      // Stop any sounding alert when the subscription tears down.
      service.stop();
    };
  }, [enabled, source, service, handleType]);

  return { lastAlert };
}
