/**
 * Semantic color tokens for the Mobile Babysitter app.
 *
 * Two palettes are provided:
 *  - LIGHT_COLORS: default daytime / setup palette.
 *  - DARK_COLORS: low-luminance palette suitable for the night / AOD baby-unit
 *    and the night-time parent-unit. The `background` token is intentionally
 *    near-black (very low luminance) to minimise light emission in a dark
 *    nursery and reduce battery draw on OLED screens (see product-spec: dim
 *    screen baby-unit, AOD status-only mode).
 *
 * Tokens are SEMANTIC (named by role, not by hue) so screens never hard-code
 * raw hex values. Both palettes share the same set of keys; `ColorTokens`
 * (derived in ./index) enforces that at the type level.
 */

/**
 * Light (daytime) semantic palette.
 */
export const LIGHT_COLORS = {
  /** App-level page background. */
  background: '#FFFFFF',
  /** Raised container surface (cards, sheets, modals). */
  surface: '#F4F5F7',
  /** Primary readable text on background/surface. */
  text: '#11181C',
  /** Secondary / de-emphasised text. */
  textMuted: '#5B6770',
  /** Brand / primary interactive color (buttons, active state). */
  primary: '#2F6FED',
  /** Text/icon color rendered on top of `primary`. */
  onPrimary: '#FFFFFF',
  /** Destructive / error state (alerts, cry-detection, disconnect). */
  danger: '#D7263D',
  /** Positive / connected / healthy state. */
  success: '#1E8E3E',
  /** Cautionary state (weak signal, battery warning). */
  warning: '#C77700',
  /** Hairline borders and dividers. */
  border: '#D9DDE1',
  /** Scrim behind modals / overlays. */
  overlay: 'rgba(17, 24, 28, 0.45)',
} as const;

/**
 * Dark / night palette. Low-luminance, OLED-friendly.
 * `background` is near-black for the AOD baby-unit and night parent-unit.
 */
export const DARK_COLORS = {
  background: '#0A0C0E',
  surface: '#15191D',
  text: '#E6EAED',
  textMuted: '#9099A1',
  primary: '#5A8DF0',
  onPrimary: '#0A0C0E',
  danger: '#F2647A',
  success: '#4FBE73',
  warning: '#E0A235',
  border: '#272D33',
  overlay: 'rgba(0, 0, 0, 0.6)',
} as const;
