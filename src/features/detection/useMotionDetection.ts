/**
 * useMotionDetection — wires a motion-metric {@link MotionMetricSource} into the
 * pure {@link MotionDetector} core and exposes React-friendly state (DMY-25).
 *
 * The source is INJECTED (dependency inversion): in production the baby-unit
 * passes a real motion-metric tap over its decoded video (DMY-17 video track +
 * DMY-45 on-device CV / frame differencing); tests pass a stub that pushes
 * synthetic metrics. The hook itself knows nothing about the camera or WebRTC.
 *
 * Because the no-motion rule is TIME-based (>30s of continuous stillness), the
 * hook also drives the detector's stillness timer on a steady cadence via
 * `setInterval` (`tickIntervalMs`) so a `no_motion` event still fires even if
 * the source stops delivering frames. The interval is injectable for tests.
 *
 * On each sample/tick it updates the live `metric`/`moving` state and, when the
 * core emits an event, stores it as `lastEvent` and invokes the matching
 * `onMotion` / `onNoMotion` callback. No frame is captured, stored or logged —
 * only scalar metrics and the privacy-safe {@link MotionEvent}.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { logger } from '../../services/logger';
import { createMotionDetector } from './motionDetector';
import type {
  MotionDetectorConfig,
  MotionEvent,
  MotionMetric,
  MotionMetricSource,
} from './motionTypes';

/** Default cadence at which the no-motion timer is polled. */
const DEFAULT_TICK_INTERVAL_MS = 1000;

/** Options for {@link useMotionDetection}. */
export interface UseMotionDetectionOptions {
  /**
   * Motion-metric source. Pushes per-frame metrics; returns an unsubscribe fn.
   * When omitted the hook stays idle (no detector wiring) — useful while the
   * real source (DMY-17/DMY-45) is not yet available.
   */
  readonly source?: MotionMetricSource;
  /** Detector thresholds / hysteresis / cooldown / no-motion duration. */
  readonly config: MotionDetectorConfig;
  /** Called whenever a `motion` event is emitted. */
  readonly onMotion?: (event: MotionEvent) => void;
  /** Called whenever a `no_motion` event is emitted. */
  readonly onNoMotion?: (event: MotionEvent) => void;
  /** When `false`, the source is not subscribed. Defaults to `true`. */
  readonly enabled?: boolean;
  /**
   * Cadence (ms) at which the stillness timer is polled while enabled. Defaults
   * to 1000ms. Lower = more responsive `no_motion`, higher = less wakeups.
   */
  readonly tickIntervalMs?: number;
}

/** Value returned by {@link useMotionDetection}. */
export interface MotionDetectionState {
  /** Most recent motion metric seen, or `null` before the first sample. */
  readonly metric: MotionMetric | null;
  /** Whether the detector currently considers the scene to be moving. */
  readonly moving: boolean;
  /** The most recently emitted motion event, or `null`. */
  readonly lastEvent: MotionEvent | null;
}

export function useMotionDetection(
  options: UseMotionDetectionOptions,
): MotionDetectionState {
  const {
    source,
    config,
    onMotion,
    onNoMotion,
    enabled = true,
    tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
  } = options;

  const [metric, setMetric] = useState<MotionMetric | null>(null);
  const [moving, setMoving] = useState(false);
  const [lastEvent, setLastEvent] = useState<MotionEvent | null>(null);

  // Keep the latest callbacks in refs so changing them does not re-subscribe the
  // source (which could drop samples / restart the stillness timer mid-session).
  const onMotionRef = useRef(onMotion);
  onMotionRef.current = onMotion;
  const onNoMotionRef = useRef(onNoMotion);
  onNoMotionRef.current = onNoMotion;

  // Recreate the detector only when the resolved config actually changes.
  const detector = useMemo(
    () =>
      createMotionDetector({
        enterThreshold: config.enterThreshold,
        exitThreshold: config.exitThreshold,
        cooldownMs: config.cooldownMs,
        noMotionThresholdMs: config.noMotionThresholdMs,
      }),
    [
      config.enterThreshold,
      config.exitThreshold,
      config.cooldownMs,
      config.noMotionThresholdMs,
    ],
  );

  // Dispatch a core event to state + the matching callback. Logs only the
  // privacy-safe metric/threshold, never a frame.
  const dispatch = useCallback((event: MotionEvent) => {
    logger.info('motion: event', {
      type: event.type,
      metric: event.metric,
      threshold: event.threshold,
    });
    setLastEvent(event);
    if (event.type === 'motion') {
      onMotionRef.current?.(event);
    } else {
      onNoMotionRef.current?.(event);
    }
  }, []);

  const handleMetric = useCallback(
    (next: MotionMetric) => {
      const { event, moving: nextMoving } = detector.push(next);
      setMetric(next);
      setMoving(nextMoving);
      if (event) {
        dispatch(event);
      }
    },
    [detector, dispatch],
  );

  useEffect(() => {
    if (!enabled || !source) {
      return;
    }
    detector.reset();
    const unsubscribe = source(handleMetric);

    // Drive the time-based no-motion rule even if frames stop arriving.
    const timer = setInterval(() => {
      const event = detector.tick();
      if (event) {
        setMoving(detector.isMoving);
        dispatch(event);
      }
    }, tickIntervalMs);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [enabled, source, detector, handleMetric, dispatch, tickIntervalMs]);

  return { metric, moving, lastEvent };
}
