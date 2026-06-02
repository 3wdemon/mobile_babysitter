/**
 * Public surface of the on-device detection feature.
 *
 * Privacy-first: nothing here captures or stores audio/video — the detectors
 * consume abstract scalar metrics and emit metric-only events.
 *
 *  - Noise-threshold detection (DMY-8): abstract loudness levels -> NoiseEvent.
 *  - Motion / no-motion detection (DMY-25): abstract per-frame motion metrics ->
 *    MotionEvent (`motion` rising edge, `no_motion` after >30s stillness).
 */
export { NoiseDetector, createNoiseDetector } from './noiseDetector';
export { useNoiseDetection } from './useNoiseDetection';
export { DEFAULT_NOISE_CONFIG } from './config';
export { default as NoiseLevelIndicator } from './NoiseLevelIndicator';
export type {
  NoiseDetectionState,
  UseNoiseDetectionOptions,
} from './useNoiseDetection';
export type {
  NoiseDetectorConfig,
  NoiseEvent,
  NoiseLevel,
  NoiseLevelSource,
  NoiseSampleResult,
} from './types';

export { MotionDetector, createMotionDetector } from './motionDetector';
export { useMotionDetection } from './useMotionDetection';
export { DEFAULT_MOTION_CONFIG, NO_MOTION_THRESHOLD_MS } from './motionConfig';
export { default as MotionIndicator } from './MotionIndicator';
export type {
  MotionDetectionState,
  UseMotionDetectionOptions,
} from './useMotionDetection';
export type {
  MotionDetectorConfig,
  MotionEvent,
  MotionEventType,
  MotionMetric,
  MotionMetricSource,
  MotionSampleResult,
} from './motionTypes';
