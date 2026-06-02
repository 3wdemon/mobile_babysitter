/**
 * i18n service (DMY-63).
 *
 * Single shared {@link I18n} instance configured with the bundled `en` + `ru`
 * catalogs. English is the default/fallback locale (the source of truth for the
 * key set); Russian is the user's preference per CLAUDE.md and ships in
 * `locales/ru.json`.
 *
 * Locale selection at startup uses react-native-localize's
 * `findBestLanguageTag(['en','ru'])` so the app follows the device language,
 * defaulting to English when the device prefers neither. With
 * `enableFallback = true`, any key missing in the active locale falls back to
 * the English catalog; a key missing in BOTH returns a non-throwing marker
 * (i18n-js default), so the UI never crashes on a missing translation.
 *
 * Consumers should prefer the {@link useTranslation} hook in components so the
 * tree re-renders on locale change; the exported {@link t} helper is for
 * non-React call sites (services, tests).
 */
import { I18n } from 'i18n-js';
import { findBestLanguageTag } from 'react-native-localize';

import en from '../../../locales/en.json';
import ru from '../../../locales/ru.json';

/** Locales the app actually ships catalogs for. */
export const SUPPORTED_LOCALES = ['en', 'ru'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Default + fallback locale. `en.json` is the source of truth for keys. */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Shared i18n instance. Both catalogs are registered up front; the active
 * locale is resolved from the device below.
 */
export const i18n = new I18n(
  { en, ru },
  {
    defaultLocale: DEFAULT_LOCALE,
    // Fall back to `defaultLocale` (en) for any key missing in the active
    // locale, instead of returning the "[missing ...]" marker.
    enableFallback: true,
  },
);

/**
 * Resolves the best startup locale for the current device, restricted to the
 * locales we ship. Falls back to {@link DEFAULT_LOCALE} when the device prefers
 * neither (or when native localize is unavailable, e.g. under tests).
 */
export function detectDeviceLocale(): SupportedLocale {
  const best = findBestLanguageTag(SUPPORTED_LOCALES);
  return best?.languageTag ?? DEFAULT_LOCALE;
}

/** Sets the active locale, restricted to a supported locale. */
export function setLocale(locale: SupportedLocale): void {
  i18n.locale = locale;
}

// Initialise the active locale from the device on module load.
i18n.locale = detectDeviceLocale();

/**
 * Translate `key` with optional interpolation/pluralization options.
 *
 * Thin wrapper over {@link I18n.t} bound to the shared instance. Missing keys
 * never throw: they resolve via the en fallback, or (if missing everywhere)
 * return i18n-js's non-throwing missing marker.
 */
export function t(
  key: string,
  options?: Record<string, unknown>,
): string {
  return i18n.t(key, options);
}
