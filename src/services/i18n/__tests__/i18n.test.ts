/**
 * Unit tests for the i18n service (DMY-63).
 *
 * Covers: English lookup, Russian lookup, missing-key fallback to English,
 * a key missing in BOTH catalogs returning a non-throwing marker, device-locale
 * detection (en default / ru / unsupported), and — importantly — key-parity
 * between the en and ru catalogs (the catalogs must define the same key set so
 * no locale silently falls back for an entire string).
 *
 * react-native-localize is mocked globally (jest.setup.js); we drive it here
 * through its __setBestLanguageTag / __resetLocalize helpers.
 */
import en from '../../../../locales/en.json';
import ru from '../../../../locales/ru.json';

type LocalizeMock = {
  __setBestLanguageTag: (tag: string | undefined) => void;
  __resetLocalize: () => void;
};

/**
 * Re-acquire the (possibly freshly reset) react-native-localize mock. Tests
 * that call `jest.resetModules()` get a new mock instance, so the helper must
 * be fetched AFTER the reset for the override to land on the same instance the
 * i18n module under test will import.
 */
function localizeMock(): LocalizeMock {
  return jest.requireMock('react-native-localize') as LocalizeMock;
}

/** Flatten a nested catalog into dotted leaf keys for set comparison. */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path];
  });
}

afterEach(() => {
  localizeMock().__resetLocalize();
  jest.resetModules();
});

describe('i18n service', () => {
  it('resolves English strings when the locale is en', () => {
    const { i18n, setLocale } = require('..');
    setLocale('en');
    expect(i18n.t('onboarding.welcome.continue')).toBe('Continue');
    expect(i18n.t('onboarding.roleSelect.options.baby.title')).toBe(
      'Baby unit',
    );
  });

  it('resolves Russian strings when the locale is ru', () => {
    const { i18n, setLocale } = require('..');
    setLocale('ru');
    expect(i18n.t('onboarding.welcome.continue')).toBe('Продолжить');
    expect(i18n.t('onboarding.roleSelect.options.baby.title')).toBe(
      'Блок малыша',
    );
  });

  it('interpolates options', () => {
    const { setLocale, t } = require('..');
    setLocale('en');
    expect(t('about.version', { version: '1.2.3' })).toBe('Version 1.2.3');
    setLocale('ru');
    expect(t('about.version', { version: '1.2.3' })).toBe('Версия 1.2.3');
  });

  it('falls back to English for a key missing in the active (ru) locale', () => {
    // Register a temporary en-only key, then look it up under ru.
    const { i18n, setLocale } = require('..');
    i18n.store({ en: { __test_only__: 'fallback-value' } });
    setLocale('ru');
    expect(i18n.t('__test_only__')).toBe('fallback-value');
  });

  it('returns a non-throwing marker for a key missing in BOTH catalogs', () => {
    const { i18n, setLocale } = require('..');
    setLocale('en');
    let result: string | undefined;
    expect(() => {
      result = i18n.t('totally.unknown.key');
    }).not.toThrow();
    // i18n-js default missingBehavior returns a "[missing ...]" marker rather
    // than throwing; the important guarantee is no crash + the key is surfaced.
    expect(result).toContain('totally.unknown.key');
  });

  it('the standalone t() helper resolves the same as the instance', () => {
    const { i18n, t, setLocale } = require('..');
    setLocale('en');
    expect(t('onboarding.permissions.allowAccess')).toBe(
      i18n.t('onboarding.permissions.allowAccess'),
    );
  });
});

describe('detectDeviceLocale', () => {
  it('defaults to English when the device prefers neither supported locale', () => {
    jest.resetModules();
    localizeMock().__setBestLanguageTag(undefined);
    const { detectDeviceLocale, DEFAULT_LOCALE } = require('..');
    expect(detectDeviceLocale()).toBe(DEFAULT_LOCALE);
    expect(detectDeviceLocale()).toBe('en');
  });

  it('selects Russian when the device best language is ru', () => {
    jest.resetModules();
    localizeMock().__setBestLanguageTag('ru');
    const { detectDeviceLocale } = require('..');
    expect(detectDeviceLocale()).toBe('ru');
  });

  it('applies the detected device locale to the instance on module load', () => {
    jest.resetModules();
    localizeMock().__setBestLanguageTag('ru');
    const { i18n } = require('..');
    // Module load ran detectDeviceLocale() -> ru.
    expect(i18n.locale).toBe('ru');
    expect(i18n.t('onboarding.welcome.continue')).toBe('Продолжить');
  });
});

describe('catalog key parity', () => {
  it('en.json and ru.json define the exact same key set', () => {
    const enKeys = flattenKeys(en as Record<string, unknown>).sort();
    const ruKeys = flattenKeys(ru as Record<string, unknown>).sort();

    const missingInRu = enKeys.filter(k => !ruKeys.includes(k));
    const missingInEn = ruKeys.filter(k => !enKeys.includes(k));

    expect(missingInRu).toEqual([]);
    expect(missingInEn).toEqual([]);
    expect(ruKeys).toEqual(enKeys);
  });

  it('neither catalog is empty (guards a trivially-passing parity check)', () => {
    expect(flattenKeys(en as Record<string, unknown>).length).toBeGreaterThan(
      10,
    );
  });
});
