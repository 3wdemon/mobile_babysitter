/**
 * Public surface of the on-device noise-threshold detection feature (DMY-8).
 *
 * Privacy-first: nothing here captures or stores audio — the detector consumes
 * abstract loudness levels and emits a metric-only {@link NoiseEvent}.
 */
export { NoiseDetector, createNoiseDetector } from './noiseDetector';
export { useNoiseDetection } from './useNoiseDetection';
export { DEFAULT_NOISE_CONFIG } from './config';
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
