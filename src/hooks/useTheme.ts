/**
 * useTheme — resolves the active design-token Theme.
 *
 * Decoupled by design (DMY-38): selection is driven by the optional `mode`
 * argument and the OS color scheme via `useColorScheme()`. It intentionally
 * does NOT import the app store (`useAppStore`, DMY-36) so the theme layer can
 * land independently. Store-driven mode integration will wrap this hook later.
 *
 *  - mode === 'light' | 'dark' -> that explicit theme.
 *  - mode === 'system' (default) -> follows `useColorScheme()`, defaulting to
 *    light when the OS reports no preference (`null`).
 */
import { useColorScheme } from 'react-native';

import { type Theme, type ThemeMode, themes } from '../theme';

/**
 * Returns the resolved {@link Theme} for the given mode.
 *
 * @param mode Theme selection. Defaults to `'system'`.
 */
export function useTheme(mode: ThemeMode = 'system'): Theme {
  const systemScheme = useColorScheme();

  if (mode === 'light' || mode === 'dark') {
    return themes[mode];
  }

  return systemScheme === 'dark' ? themes.dark : themes.light;
}
