/**
 * Unit tests for the useTranslation hook (DMY-63).
 *
 * Verifies the hook returns a working translator bound to the shared i18n
 * instance, reports the active locale, and — crucially — re-renders the
 * consuming component when the locale changes at runtime (so a future in-app
 * language switch updates the UI without a remount).
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { useTranslation } from '../useTranslation';
import { i18n, setLocale } from '../../services/i18n';

afterEach(() => {
  setLocale('en');
});

function Probe() {
  const { t, locale } = useTranslation();
  return (
    <Text testID="probe">{`${locale}:${t('onboarding.welcome.continue')}`}</Text>
  );
}

describe('useTranslation', () => {
  it('translates using the active locale and reports it', () => {
    setLocale('en');
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('en:Continue');
  });

  it('re-renders the consumer when the locale changes at runtime', () => {
    setLocale('en');
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('en:Continue');

    // Switch locale on the shared instance; the hook's onChange subscription
    // must drive a re-render with the Russian copy.
    act(() => {
      setLocale('ru');
    });

    expect(screen.getByTestId('probe')).toHaveTextContent('ru:Продолжить');
  });

  it('forwards interpolation options to the instance', () => {
    setLocale('en');
    function VersionProbe() {
      const { t } = useTranslation();
      return <Text testID="ver">{t('about.version', { version: '9.9.9' })}</Text>;
    }
    render(<VersionProbe />);
    expect(screen.getByTestId('ver')).toHaveTextContent('Version 9.9.9');
    // Sanity: same as a direct instance call.
    expect(i18n.t('about.version', { version: '9.9.9' })).toBe('Version 9.9.9');
  });

  it('interpolates through the hook in both locales and updates on switch', () => {
    // about.version = "Version {{version}}" / "Версия {{version}}". This is the
    // path screens actually use, so prove interpolation survives a runtime
    // locale switch in the consuming component (AC step 5: interpolation in
    // both locales).
    setLocale('en');
    function VersionProbe() {
      const { t } = useTranslation();
      return <Text testID="ver">{t('about.version', { version: '1.2.3' })}</Text>;
    }
    render(<VersionProbe />);
    expect(screen.getByTestId('ver')).toHaveTextContent('Version 1.2.3');

    act(() => {
      setLocale('ru');
    });

    expect(screen.getByTestId('ver')).toHaveTextContent('Версия 1.2.3');
  });
});
