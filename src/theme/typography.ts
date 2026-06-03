/**
 * Typography tokens: font sizes, weights and line heights.
 *
 * Sizes and lineHeights are in density-independent pixels. Weights are
 * React Native `fontWeight` string values so they can be applied directly
 * to text styles.
 *
 * Dynamic type / font scaling (DMY-65)
 * ------------------------------------
 * The tokens below are the BASE (1.0x) sizes. React Native scales `<Text>` by
 * the OS font-size setting automatically because `allowFontScaling` defaults to
 * `true` — we deliberately never set `allowFontScaling={false}` on meaningful
 * copy, so increasing the system font size enlarges the UI as the user expects
 * (AC #2). The helpers here are for the two cases where the automatic behaviour
 * is not enough:
 *
 *  - {@link MAX_FONT_SIZE_MULTIPLIER}: a sane upper bound to pass as
 *    `maxFontSizeMultiplier` on dense/space-constrained text (chips, compact
 *    labels) so extreme accessibility sizes scale up but stop short of
 *    overlapping/clipping the layout. Body copy can omit it (no cap).
 *  - {@link scaledFontSize}: resolves a base size against the CURRENT device
 *    font scale for non-`<Text>` surfaces that need a pixel value up front
 *    (e.g. computing an icon/touch-target size that should grow with text).
 *    `<Text>` itself should NOT use this — it already scales on its own;
 *    double-scaling would over-enlarge.
 */
import { PixelRatio } from 'react-native';

/**
 * Font size scale.
 */
export const FONT_SIZES = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Font weights (React Native `fontWeight` values).
 */
export const FONT_WEIGHTS = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Line heights (absolute dp) aligned to the font size scale.
 */
export const LINE_HEIGHTS = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 28,
  xl: 32,
  xxl: 40,
} as const;

/**
 * Upper bound for OS font scaling on space-constrained text.
 *
 * Pass this as `maxFontSizeMultiplier` on dense controls (chips, single-line
 * labels, icon captions) so very large accessibility sizes still scale up but
 * stop short of breaking the layout. Chosen at 1.6x: large enough to be a real
 * accessibility win, small enough that fixed-width chips do not overlap. Body
 * paragraphs should leave this unset (uncapped) so long-form copy scales fully.
 */
export const MAX_FONT_SIZE_MULTIPLIER = 1.6;

/**
 * Resolve a base font size against the CURRENT device font scale.
 *
 * Use only where a non-`<Text>` element needs an explicit scaled pixel value
 * up front (e.g. sizing an icon glyph or touch target so it grows with text).
 * Do NOT apply to `<Text>` `fontSize` — `<Text>` already scales itself, so this
 * would double-scale. The result is rounded to the nearest layout pixel.
 *
 * @param base A base size from {@link FONT_SIZES} (or any dp value).
 * @param max Optional cap on the applied scale (defaults to
 *   {@link MAX_FONT_SIZE_MULTIPLIER}); pass `Infinity` for no cap.
 */
export function scaledFontSize(
  base: number,
  max: number = MAX_FONT_SIZE_MULTIPLIER,
): number {
  const scale = Math.min(PixelRatio.getFontScale(), max);
  return PixelRatio.roundToNearestPixel(base * scale);
}

/**
 * Aggregated typography token group.
 */
export const TYPOGRAPHY = {
  fontSizes: FONT_SIZES,
  fontWeights: FONT_WEIGHTS,
  lineHeights: LINE_HEIGHTS,
  maxFontSizeMultiplier: MAX_FONT_SIZE_MULTIPLIER,
} as const;
