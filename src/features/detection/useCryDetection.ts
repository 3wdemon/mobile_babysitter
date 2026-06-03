/**
 * useCryDetection — wires a {@link CrySampleSource} into the pure
 * {@link CryHeuristicDetector} core and exposes React-friendly state plus an
 * `onCry` callback (DMY-49).
 *
 * The source is INJECTED (dependency inversion): in production the baby-unit
 * passes a real audio-feature tap (RMS + 250-2000Hz band-energy from the DSP —
 * DMY-18/DMY-9); tests pass a stub that pushes synthetic samples. The hook knows
 * nothing about microphones or WebRTC.
 *
 * PURE DETECTOR (mirrors {@link useNoiseDetection}'s `onNoise` and
 * {@link useMotionDetection}'s `onMotion`): on each sample it updates the live
 * `lastSample`/`candidate` state and, when the core emits an event, stores it as
 * `lastEvent` and invokes `onCry`. It NEVER touches the {@link AlertService}
 * directly — the alert layer is the parent screen's concern.
 *
 * ALERT WIRING: the parent screen adapts this hook's `onCry` into the SAME
 * {@link AlertEventSource} that {@link useAlerts} consumes, exactly as it adapts
 * `onNoise`/`onMotion`:
 *
 * ```ts
 * // In the parent screen, alongside the noise/motion adapters:
 * const cryAlertSource: AlertEventSource = onAlertType => {
 *   setCryListener(() => () => onAlertType('cry'));
 *   return () => setCryListener(null);
 * };
 * // and useCryDetection({ ..., onCry: () => cryListener?.() });
 * ```
 *
 * Routing through {@link useAlerts} (rather than calling `alertService.handle`
 * here) is what makes cry obey ALL parent-side policy — enablement, per-type
 * throttle/cooldown, priority, snooze (cry is flagged `breaksThroughSnooze`) —
 * AND drives BOTH sinks: the per-type `alert-cry` sound (DMY-26) and the local
 * notification presenter (DMY-46), which fire in parallel for every RAISED
 * event in {@link useAlerts}' `handleType`. Calling the service directly here
 * would drive only the sound and silently skip the notification, so we do not.
 * When the ML detector (DMY-21) lands it emits the SAME `'cry'` {@link AlertType}
 * through the same path, so nothing downstream changes.
 *
 * Privacy: only the privacy-safe {@link CryEvent} (features + confidence + time)
 * is ever exposed or logged — never any audio buffer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { logger } from '../../services/logger';
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
   * Called once per detected cry episode (not per sample). The parent screen
   * adapts this into the {@link AlertEventSource} consumed by `useAlerts`,
   * exactly like `useNoiseDetection`'s `onNoise` / `useMotionDetection`'s
   * `onMotion` — so cry flows through the same sound + notification + policy
   * pipeline.
   */
  readonly onCry?: (event: CryEvent) => void;
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
}

export function useCryDetection(
  options: UseCryDetectionOptions,
): CryDetectionState {
  const { source, config, onCry, enabled = true } = options;

  const [lastSample, setLastSample] = useState<CrySample | null>(null);
  const [candidate, setCandidate] = useState(false);
  const [lastEvent, setLastEvent] = useState<CryEvent | null>(null);

  // Keep the latest callback in a ref so changing it does not re-subscribe the
  // source (which could drop samples / reset an episode mid-session).
  const onCryRef = useRef(onCry);
  onCryRef.current = onCry;

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

  return { lastSample, candidate, lastEvent };
}
