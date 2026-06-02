/**
 * useTranslation — React binding for the shared i18n instance (DMY-63).
 *
 * Returns a `t(key, options)` translator bound to the app's {@link i18n}
 * instance plus the current `locale`. The hook subscribes to i18n-js's
 * `onChange` so that components re-render when the active locale (or the
 * registered translations) change at runtime — e.g. a future in-app language
 * switcher. With no locale changes it is effectively static.
 */
import { useCallback, useSyncExternalStore } from 'react';

import { i18n } from '../services/i18n';

/** Subscribe React to i18n locale/translation changes. */
function subscribe(onStoreChange: () => void): () => void {
  // i18n-js `onChange` returns an unsubscribe function.
  return i18n.onChange(onStoreChange);
}

/** Current active locale; the snapshot React tracks for re-renders. */
function getSnapshot(): string {
  return i18n.locale;
}

export interface UseTranslation {
  /** Translate `key` with optional interpolation/pluralization options. */
  t: (key: string, options?: Record<string, unknown>) => string;
  /** The currently active locale (e.g. `"en"`, `"ru"`). */
  locale: string;
}

/**
 * Hook returning a re-render-friendly translator.
 *
 * The returned `t` is stable across renders for a given locale; it changes
 * identity when the locale changes so memoised children re-translate.
 */
export function useTranslation(): UseTranslation {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const t = useCallback(
    (key: string, options?: Record<string, unknown>): string =>
      i18n.t(key, options),
    // `locale` is the dependency: a new translator identity per active locale
    // even though it always reads from the same singleton instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  return { t, locale };
}
