/**
 * useTheme — resolves the active design-token Theme.
 *
 * Mode resolution (DMY-70):
 *  - `useTheme()` (no argument) reads the persisted preference from the app
 *    store (`useThemePreference`) so the choice made in Settings propagates to
 *    every non-hardcoded screen.
 *  - `useTheme(mode)` with an explicit `'light' | 'dark' | 'system'` argument
 *    overrides the store. This `mode` prop-seam is preserved on purpose: it
 *    keeps the hook trivially unit-testable (no store setup needed) and lets
 *    intentionally-themed surfaces pin a scheme.
 *
 * Concrete resolution once a mode is known:
 *  - `'light' | 'dark'` -> that explicit theme.
 *  - `'system'` -> follows `useColorScheme()`, defaulting to light when the OS
 *    reports no preference (`null`).
 *
 * NOTE — intentionally-dark surfaces. Some surfaces are dark *by design* and do
 * NOT honour the persisted preference: the Baby unit screen, PowerSaverIndicator,
 * ParentMediaView and TalkButton. These are the night-time face of the monitor
 * (a dim bedroom), so they call `useTheme('dark')` explicitly via the prop-seam
 * and are unaffected by the store default added here.
 */
import { useColorScheme } from 'react-native';

import { useThemePreference } from '../store/useAppStore';
import { type Theme, type ThemeMode, themes } from '../theme';

/**
 * Returns the resolved {@link Theme}.
 *
 * @param mode Explicit theme selection that overrides the persisted preference.
 *   When omitted, the persisted preference from the app store is used (default
 *   `'system'` until the user changes it in Settings).
 */
export function useTheme(mode?: ThemeMode): Theme {
  const systemScheme = useColorScheme();
  // Hooks must run unconditionally; the store value is only consulted when no
  // explicit `mode` was passed.
  const storedPreference = useThemePreference();

  const effectiveMode = mode ?? storedPreference;

  if (effectiveMode === 'light' || effectiveMode === 'dark') {
    return themes[effectiveMode];
  }

  return systemScheme === 'dark' ? themes.dark : themes.light;
}
