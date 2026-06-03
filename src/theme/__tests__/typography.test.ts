/**
 * Unit tests for the typography font-scaling helpers (DMY-65).
 *
 * Dynamic type is the AC #2 concern: the app must honour the OS font-size
 * setting. These cover the two scaling primitives — the shared
 * `maxFontSizeMultiplier` cap exposed on the token group, and `scaledFontSize`,
 * which resolves a base size against the CURRENT device font scale (clamped to
 * a max). The helper is the only place we read `PixelRatio.getFontScale()`, so
 * spying on it drives every branch deterministically.
 */
import { PixelRatio } from 'react-native';

import {
  MAX_FONT_SIZE_MULTIPLIER,
  TYPOGRAPHY,
  scaledFontSize,
} from '../typography';

describe('typography font scaling (DMY-65)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes the max multiplier on the token group for components to reuse', () => {
    expect(TYPOGRAPHY.maxFontSizeMultiplier).toBe(MAX_FONT_SIZE_MULTIPLIER);
    // A real accessibility win but bounded so dense controls do not overflow.
    expect(MAX_FONT_SIZE_MULTIPLIER).toBeGreaterThan(1);
    expect(MAX_FONT_SIZE_MULTIPLIER).toBeLessThanOrEqual(2);
  });

  it('scales a base size by the device font scale', () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.25);
    // 16 * 1.25 = 20 (rounded to the nearest layout pixel).
    expect(scaledFontSize(16)).toBe(20);
  });

  it('returns the base size unchanged at the default 1.0 scale', () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
    expect(scaledFontSize(16)).toBe(16);
  });

  it('caps the applied scale at the max multiplier so layouts do not break', () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(3);
    // Clamped to MAX_FONT_SIZE_MULTIPLIER, not the raw 3x.
    expect(scaledFontSize(10)).toBe(
      PixelRatio.roundToNearestPixel(10 * MAX_FONT_SIZE_MULTIPLIER),
    );
  });

  it('honours an explicit max override (e.g. Infinity for uncapped body copy)', () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(3);
    expect(scaledFontSize(10, Infinity)).toBe(30);
  });
});
