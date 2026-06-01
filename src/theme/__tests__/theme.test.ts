import {
  DARK_COLORS,
  LIGHT_COLORS,
  SPACING,
  TYPOGRAPHY,
  darkTheme,
  lightTheme,
  themes,
  type Theme,
} from '../index';

describe('design tokens / theme', () => {
  const COLOR_KEYS = [
    'background',
    'surface',
    'text',
    'textMuted',
    'primary',
    'onPrimary',
    'danger',
    'success',
    'warning',
    'border',
    'overlay',
  ] as const;

  it('exposes both light and dark themes with the same shape', () => {
    for (const theme of [lightTheme, darkTheme] as Theme[]) {
      expect(theme.colors).toBeDefined();
      expect(theme.spacing).toBe(SPACING);
      expect(theme.typography).toBe(TYPOGRAPHY);
    }
    expect(lightTheme.scheme).toBe('light');
    expect(darkTheme.scheme).toBe('dark');
  });

  it('light and dark palettes share the exact same key set', () => {
    expect(Object.keys(LIGHT_COLORS).sort()).toEqual(
      Object.keys(DARK_COLORS).sort(),
    );
    for (const key of COLOR_KEYS) {
      expect(LIGHT_COLORS).toHaveProperty(key);
      expect(DARK_COLORS).toHaveProperty(key);
    }
  });

  it('provides the 4-point spacing scale', () => {
    expect(SPACING).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 });
  });

  it('provides typography sizes, weights and line heights', () => {
    expect(TYPOGRAPHY.fontSizes.md).toBe(16);
    expect(TYPOGRAPHY.fontWeights.bold).toBe('700');
    expect(TYPOGRAPHY.lineHeights.md).toBe(24);
  });

  it('resolves themes via the lookup table', () => {
    expect(themes.light).toBe(lightTheme);
    expect(themes.dark).toBe(darkTheme);
  });

  it('dark palette has a low-luminance (near-black) background', () => {
    // background token must be far darker than the light counterpart.
    expect(DARK_COLORS.background).toBe('#0A0C0E');

    const luminance = (hex: string): number => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      // Perceptual luminance approximation (0..255).
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };

    expect(luminance(DARK_COLORS.background)).toBeLessThan(20);
    expect(luminance(LIGHT_COLORS.background)).toBeGreaterThan(200);
  });
});
