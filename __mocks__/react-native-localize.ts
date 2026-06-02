/**
 * Jest mock for `react-native-localize` (DMY-63).
 *
 * The real library reads the device's locale settings through a native module
 * with no JS fallback under Jest. This mock provides the single function the
 * i18n service uses — `findBestLanguageTag` — defaulting to English so the app
 * mounts deterministically. Tests can drive locale selection via the exported
 * `__setBestLanguageTag` helper (e.g. to assert the Russian catalog renders).
 *
 * Only the surface the app touches is implemented; the rest of the API is
 * intentionally omitted.
 */

type BestLanguage = { languageTag: string; isRTL: boolean } | undefined;

let bestLanguageTag: BestLanguage = { languageTag: 'en', isRTL: false };

export const findBestLanguageTag = jest.fn(
  <T extends string>(_languageTags: readonly T[]): BestLanguage =>
    bestLanguageTag,
);

/**
 * Test helper: set what `findBestLanguageTag` returns next. Pass a bare
 * language tag for convenience, or `undefined` to simulate "device prefers
 * none of the supported locales".
 */
export function __setBestLanguageTag(tag: string | undefined): void {
  bestLanguageTag =
    tag === undefined ? undefined : { languageTag: tag, isRTL: false };
}

/** Test helper: restore the default (English) device locale. */
export function __resetLocalize(): void {
  bestLanguageTag = { languageTag: 'en', isRTL: false };
  findBestLanguageTag.mockClear();
}
