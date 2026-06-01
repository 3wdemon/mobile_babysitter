/**
 * Typography tokens: font sizes, weights and line heights.
 *
 * Sizes and lineHeights are in density-independent pixels. Weights are
 * React Native `fontWeight` string values so they can be applied directly
 * to text styles.
 */

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
 * Aggregated typography token group.
 */
export const TYPOGRAPHY = {
  fontSizes: FONT_SIZES,
  fontWeights: FONT_WEIGHTS,
  lineHeights: LINE_HEIGHTS,
} as const;
