/**
 * useNoiseDetection — wires a loudness {@link NoiseLevelSource} into the pure
 * {@link NoiseDetector} core and exposes React-friendly state (DMY-8).
 *
 * The source is INJECTED (dependency inversion): in production the baby-unit
 * passes a real audio-level meter (DMY-18); tests pass a stub that pushes
 * synthetic levels. The hook itself knows nothing about microphones or WebRTC.
 *
 * On each sample it updates the live `level`/`armed` state and, when the core
 * emits an event, stores it as `lastEvent` and invokes the optional `onNoise`
 * callback. No audio is captured, stored or logged — only scalar levels and the
 * privacy-safe {@link NoiseEvent}.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { logger } from '../../services/logger';
import { createNoiseDetector } from './noiseDetector';
import type {
  NoiseDetectorConfig,
  NoiseEvent,
  NoiseLevel,
  NoiseLevelSource,
} from './types';

/** Options for {@link useNoiseDetection}. */
export interface UseNoiseDetectionOptions {
  /**
   * Audio-level source. Pushes loudness samples; returns an unsubscribe fn.
   * When omitted the hook stays idle (no detector wiring) — useful while the
   * real source (DMY-18) is not yet available.
   */
  readonly source?: NoiseLevelSource;
  /** Detector thresholds / hysteresis / cooldown. */
  readonly config: NoiseDetectorConfig;
  /** Called whenever a noise event is emitted. */
  readonly onNoise?: (event: NoiseEvent) => void;
  /** When `false`, the source is not subscribed. Defaults to `true`. */
  readonly enabled?: boolean;
}

/** Value returned by {@link useNoiseDetection}. */
export interface NoiseDetectionState {
  /** Most recent loudness level seen, or `null` before the first sample. */
  readonly level: NoiseLevel | null;
  /** Whether the detector is currently in the loud band. */
  readonly armed: boolean;
  /** The most recently emitted noise event, or `null`. */
  readonly lastEvent: NoiseEvent | null;
}

export function useNoiseDetection(
  options: UseNoiseDetectionOptions,
): NoiseDetectionState {
  const { source, config, onNoise, enabled = true } = options;

  const [level, setLevel] = useState<NoiseLevel | null>(null);
  const [armed, setArmed] = useState(false);
  const [lastEvent, setLastEvent] = useState<NoiseEvent | null>(null);

  // Keep the latest callback in a ref so changing it does not re-subscribe the
  // source (which could drop samples mid-session).
  const onNoiseRef = useRef(onNoise);
  onNoiseRef.current = onNoise;

  // Recreate the detector only when the resolved config actually changes.
  const detector = useMemo(
    () =>
      createNoiseDetector({
        enterThreshold: config.enterThreshold,
        exitThreshold: config.exitThreshold,
        cooldownMs: config.cooldownMs,
      }),
    [config.enterThreshold, config.exitThreshold, config.cooldownMs],
  );

  const handleLevel = useCallback(
    (next: NoiseLevel) => {
      const { event, armed: nextArmed } = detector.push(next);
      setLevel(next);
      setArmed(nextArmed);
      if (event) {
        // Log only the privacy-safe metric (level/threshold), never audio.
        logger.info('noise: threshold crossed', {
          level: event.level,
          threshold: event.threshold,
        });
        setLastEvent(event);
        onNoiseRef.current?.(event);
      }
    },
    [detector],
  );

  useEffect(() => {
    if (!enabled || !source) {
      return;
    }
    detector.reset();
    const unsubscribe = source(handleLevel);
    return () => {
      unsubscribe();
    };
  }, [enabled, source, detector, handleLevel]);

  return { level, armed, lastEvent };
}
