/**
 * Theme assembly and public types for the Mobile Babysitter design tokens.
 *
 * `lightTheme` and `darkTheme` share a single `Theme` type. Because palettes
 * are declared `as const`, the `ColorTokens` type is derived from the LIGHT
 * palette keys: referencing a token that does not exist (e.g.
 * `theme.colors.foo`) is a compile-time error. The `satisfies` checks below
 * also guarantee both palettes expose the exact same set of color keys.
 */
import { DARK_COLORS, LIGHT_COLORS } from './colors';
import { SPACING } from './spacing';
import { TYPOGRAPHY } from './typography';

/** Supported color scheme identifiers. */
export type ColorSchemeName = 'light' | 'dark';

/** Theme selection mode accepted by consumers (e.g. `useTheme`). */
export type ThemeMode = ColorSchemeName | 'system';

/**
 * Semantic color tokens. Derived from the LIGHT palette so the key set is the
 * single source of truth shared by both palettes.
 */
export type ColorTokens = { readonly [K in keyof typeof LIGHT_COLORS]: string };

/** Spacing scale type. */
export type Spacing = typeof SPACING;

/** Typography token group type. */
export type Typography = typeof TYPOGRAPHY;

/**
 * The full resolved theme passed to components.
 */
export interface Theme {
  readonly scheme: ColorSchemeName;
  readonly colors: ColorTokens;
  readonly spacing: Spacing;
  readonly typography: Typography;
}

// Compile-time guarantee: both palettes satisfy the shared token contract.
// If a key is missing or added to only one palette, this fails to compile.
const lightColors = LIGHT_COLORS satisfies ColorTokens;
const darkColors = DARK_COLORS satisfies ColorTokens;

/** Light (daytime) theme. */
export const lightTheme: Theme = {
  scheme: 'light',
  colors: lightColors,
  spacing: SPACING,
  typography: TYPOGRAPHY,
};

/** Dark (night / AOD) theme. */
export const darkTheme: Theme = {
  scheme: 'dark',
  colors: darkColors,
  spacing: SPACING,
  typography: TYPOGRAPHY,
};

/** Lookup table for resolving a concrete scheme to its theme. */
export const themes: Record<ColorSchemeName, Theme> = {
  light: lightTheme,
  dark: darkTheme,
};

export { LIGHT_COLORS, DARK_COLORS } from './colors';
export { SPACING } from './spacing';
export {
  TYPOGRAPHY,
  FONT_SIZES,
  FONT_WEIGHTS,
  LINE_HEIGHTS,
} from './typography';
