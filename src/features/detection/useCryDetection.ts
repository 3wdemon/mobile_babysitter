/**
 * useCryDetection — wires a {@link CrySampleSource} into the pure
 * {@link CryHeuristicDetector} core and, on a "probable cry", raises the `'cry'`
 * {@link AlertType} through the parent's {@link AlertService} (DMY-49).
 *
 * The source is INJECTED (dependency inversion): in production the baby-unit
 * passes a real audio-feature tap (RMS + 250-2000Hz band-energy from the DSP —
 * DMY-18/DMY-9); tests pass a stub that pushes synthetic samples. The hook knows
 * nothing about microphones or WebRTC.
 *
 * BRIDGE: on each {@link CryEvent} the hook calls `alertService.handle('cry')`
 * rather than playing a sound itself. Going through the service means the cry
 * alert obeys ALL the existing parent-side policy — enablement, the per-type
 * throttle/cooldown, priority, and snooze (cry is flagged `breaksThroughSnooze`,
 * so a genuine cry still sounds even while snoozed) — and plays the distinct
 * `alert-cry` sound (DMY-26). It NEVER bypasses policy: a cry that the service
 * drops (disabled / cooldown / priority) raises no alert and is not surfaced as
 * `lastAlert`. When the ML detector (DMY-21) lands it emits the SAME `'cry'`
 * type through the same bridge, so nothing downstream changes.
 *
 * Privacy: only the privacy-safe {@link CryEvent} (features + confidence + time)
 * and the resulting {@link AlertEvent} (type + time + soundId) are ever exposed
 * or logged — never any audio buffer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { logger } from '../../services/logger';
import type { AlertEvent } from '../alerts/alertTypes';
import type { AlertService } from '../alerts/alertService';
import { createCryHeuristicDetector } from './cryHeuristic';
import type {
  CryEvent,
  CryHeuristicConfig,
  CrySample,
  CrySampleSource,
} from './cryTypes';

/** Options for {@link useCryDetection}. */
export interface UseCryDetectionOptions {
  /**
   * Cry-feature source. Pushes per-frame {@link CrySample}s; returns an
   * unsubscribe fn. When omitted the hook stays idle (no detector wiring) —
   * useful while the real DSP source (DMY-18/DMY-9) is not yet available.
   */
  readonly source?: CrySampleSource;
  /** Heuristic thresholds / duration / re-arm. */
  readonly config: CryHeuristicConfig;
  /**
   * The parent-unit {@link AlertService} the cry is raised through. INJECTED so
   * cry shares the SAME service (and therefore the same throttle / priority /
   * snooze state) as noise/motion alerts. When omitted the hook still runs the
   * detector and fires `onCry`, but raises no audible alert (useful in tests /
   * before the alert layer is wired).
   */
  readonly alertService?: Pick<AlertService, 'handle'>;
  /**
   * Called whenever the heuristic emits a cry event, BEFORE the alert-service
   * policy is applied. Fires for every detected episode even if the service then
   * drops the alert (e.g. cooldown), so callers can observe raw detections.
   */
  readonly onCry?: (event: CryEvent) => void;
  /**
   * Called whenever the cry actually RAISED an alert (i.e. survived the service
   * policy). Receives the resulting {@link AlertEvent}. Not called when the
   * service drops the cry.
   */
  readonly onAlert?: (event: AlertEvent) => void;
  /** When `false`, the source is not subscribed. Defaults to `true`. */
  readonly enabled?: boolean;
}

/** Value returned by {@link useCryDetection}. */
export interface CryDetectionState {
  /** Most recent sample seen, or `null` before the first sample. */
  readonly lastSample: CrySample | null;
  /** Whether a candidate (cry-shaped) stretch is currently in progress. */
  readonly candidate: boolean;
  /** The most recently emitted cry detection event, or `null`. */
  readonly lastEvent: CryEvent | null;
  /** The most recent cry alert that was actually raised, or `null`. */
  readonly lastAlert: AlertEvent | null;
}

export function useCryDetection(
  options: UseCryDetectionOptions,
): CryDetectionState {
  const { source, config, alertService, onCry, onAlert, enabled = true } =
    options;

  const [lastSample, setLastSample] = useState<CrySample | null>(null);
  const [candidate, setCandidate] = useState(false);
  const [lastEvent, setLastEvent] = useState<CryEvent | null>(null);
  const [lastAlert, setLastAlert] = useState<AlertEvent | null>(null);

  // Keep the latest callbacks / service in refs so swapping them does not
  // re-subscribe the source (which could drop samples / reset an episode).
  const onCryRef = useRef(onCry);
  onCryRef.current = onCry;
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;
  const alertServiceRef = useRef(alertService);
  alertServiceRef.current = alertService;

  // Recreate the detector only when the resolved config actually changes.
  const detector = useMemo(
    () =>
      createCryHeuristicDetector({
        rmsThreshold: config.rmsThreshold,
        bandEnergyRatioThreshold: config.bandEnergyRatioThreshold,
        minDurationMs: config.minDurationMs,
        rearmClearMs: config.rearmClearMs,
      }),
    [
      config.rmsThreshold,
      config.bandEnergyRatioThreshold,
      config.minDurationMs,
      config.rearmClearMs,
    ],
  );

  const handleSample = useCallback(
    (sample: CrySample) => {
      const { event, candidate: nextCandidate } = detector.push(sample);
      setLastSample(sample);
      setCandidate(nextCandidate);
      if (!event) {
        return;
      }

      // Privacy: log only the features/confidence, never any audio.
      logger.info('cry: heuristic detected', {
        confidence: event.confidence,
        rms: event.rms,
        bandEnergyRatio: event.bandEnergyRatio,
      });
      setLastEvent(event);
      onCryRef.current?.(event);

      // BRIDGE: raise through the AlertService so ALL policy (enablement /
      // throttle / priority / snooze + the distinct cry sound) applies. We do
      // NOT bypass it: a dropped cry raises nothing and is not surfaced.
      const service = alertServiceRef.current;
      if (!service) {
        return;
      }
      const { event: alert } = service.handle('cry');
      if (alert) {
        setLastAlert(alert);
        onAlertRef.current?.(alert);
      }
    },
    [detector],
  );

  useEffect(() => {
    if (!enabled || !source) {
      return;
    }
    detector.reset();
    const unsubscribe = source(handleSample);
    return () => {
      unsubscribe();
    };
  }, [enabled, source, detector, handleSample]);

  return { lastSample, candidate, lastEvent, lastAlert };
}
