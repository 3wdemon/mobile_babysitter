/**
 * PinSettings — the set/change/remove-PIN surface for the Settings screen
 * (DMY-44).
 *
 * DMY-10 shipped the PIN *service* and the lock *gate* but no UI to configure a
 * PIN; the only way to set one was a store/test action. This self-contained
 * component (hosted by {@link SettingsScreen}, mirroring `PermissionReRequest`)
 * lets the parent:
 *  - see whether a PIN is configured (and whether it is a legacy pre-DMY-44 PIN
 *    that will upgrade on next unlock),
 *  - set or change the PIN with an entry + confirm flow (both fields masked,
 *    digits only, validated for length + match),
 *  - remove the PIN, and
 *  - see the current lockout state (rate-limit after repeated wrong unlocks).
 *
 * Security:
 *  - both inputs use `secureTextEntry`; the PIN lives only in local component
 *    state for the duration of the edit and is cleared after submit/remove.
 *  - the raw PIN is NEVER passed to the logger or rendered back; only coarse,
 *    non-sensitive status copy is shown.
 *  - hashing/storage is delegated entirely to {@link pinService} (PBKDF2 +
 *    keychain). This component never touches crypto or the keychain directly.
 *
 * Theme-tokenized, accessible, and fully i18n'd (en + ru) via `useTranslation`.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { useAppStore } from '../../store/useAppStore';
import {
  DEFAULT_LOCKOUT_POLICY,
  getLockoutStatus,
} from './lockoutPolicy';
import {
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  clearPin,
  getStoredPinFormat,
  hasPin,
  setPin,
} from './pinService';

/** Keep only digits and bound the length, matching the service's format rules. */
function sanitizePin(next: string): string {
  return next.replace(/[^0-9]/g, '').slice(0, MAX_PIN_LENGTH);
}

function PinSettings() {
  const { t } = useTranslation();
  const themePref = useAppStore(s => s.settings.theme);
  const theme = useTheme(themePref);

  const pinLockout = useAppStore(s => s.pinLockout);
  const resetPinLockout = useAppStore(s => s.resetPinLockout);
  const lockout = getLockoutStatus(
    pinLockout,
    DEFAULT_LOCKOUT_POLICY,
    Date.now(),
  );

  const [configured, setConfigured] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Probe stored-PIN state on mount and after each mutation.
  const refresh = useCallback(async () => {
    const has = await hasPin();
    setConfigured(has);
    if (has) {
      const fmt = await getStoredPinFormat();
      setLegacy(fmt === 'legacy');
    } else {
      setLegacy(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      /* hasPin/getStoredPinFormat are non-throwing; belt-and-braces. */
    });
  }, [refresh]);

  const resetForm = useCallback(() => {
    setPinValue('');
    setConfirm('');
    setError(null);
    setEditing(false);
  }, []);

  const onSubmit = useCallback(async () => {
    setError(null);
    if (pin.length < MIN_PIN_LENGTH) {
      setError(t('settings.security.errors.tooShort', { min: MIN_PIN_LENGTH }));
      return;
    }
    if (pin !== confirm) {
      setError(t('settings.security.errors.mismatch'));
      return;
    }
    setBusy(true);
    try {
      const result = await setPin(pin);
      if (!result.ok) {
        setError(
          result.reason === 'invalid-format'
            ? t('settings.security.errors.invalid', { min: MIN_PIN_LENGTH })
            : t('settings.security.errors.saveFailed'),
        );
        return;
      }
      // A freshly-set PIN resets any prior lockout — the secret changed.
      resetPinLockout();
      resetForm();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [confirm, pin, refresh, resetForm, resetPinLockout, t]);

  const onRemove = useCallback(async () => {
    setBusy(true);
    try {
      await clearPin();
      resetPinLockout();
      resetForm();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh, resetForm, resetPinLockout]);

  const inputStyle = [
    styles.input,
    {
      color: theme.colors.text,
      backgroundColor: theme.colors.background,
      borderColor: error ? theme.colors.danger : theme.colors.border,
      borderRadius: theme.spacing.sm,
      padding: theme.spacing.md,
      marginTop: theme.spacing.sm,
      fontSize: theme.typography.fontSizes.lg,
    },
  ];

  const cardStyle = {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    marginHorizontal: theme.spacing.lg,
    borderRadius: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  };

  const labelStyle = {
    color: theme.colors.text,
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.semibold,
  };
  const hintStyle = {
    color: theme.colors.textMuted,
    fontSize: theme.typography.fontSizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    marginTop: theme.spacing.xs,
  };

  // Precomputed so the style object below carries no ternary (keeps
  // react-native/no-inline-styles quiet).
  const busyOpacity = busy ? 0.5 : 1;

  // Status hint summarising the current PIN/lockout state.
  let statusHint: string;
  if (lockout.locked) {
    statusHint = t('settings.security.lockedOut', {
      seconds: Math.ceil(lockout.remainingMs / 1000),
    });
  } else if (!configured) {
    statusHint = t('settings.security.notSet');
  } else if (legacy) {
    statusHint = t('settings.security.legacy');
  } else {
    statusHint = t('settings.security.set');
  }

  return (
    <View testID="settings-pin" style={[styles.card, cardStyle]}>
      <Text style={labelStyle}>{t('settings.security.pinLabel')}</Text>
      <Text testID="settings-pin-status" style={hintStyle}>
        {statusHint}
      </Text>

      {editing ? (
        <View>
          <TextInput
            testID="settings-pin-input"
            accessibilityLabel={t('settings.security.pinInputA11y')}
            style={inputStyle}
            value={pin}
            onChangeText={next => {
              setPinValue(sanitizePin(next));
              if (error) {
                setError(null);
              }
            }}
            keyboardType="number-pad"
            secureTextEntry
            editable={!busy}
            maxLength={MAX_PIN_LENGTH}
            placeholder={t('settings.security.pinPlaceholder')}
            placeholderTextColor={theme.colors.textMuted}
          />
          <TextInput
            testID="settings-pin-confirm"
            accessibilityLabel={t('settings.security.confirmInputA11y')}
            style={inputStyle}
            value={confirm}
            onChangeText={next => {
              setConfirm(sanitizePin(next));
              if (error) {
                setError(null);
              }
            }}
            keyboardType="number-pad"
            secureTextEntry
            editable={!busy}
            maxLength={MAX_PIN_LENGTH}
            placeholder={t('settings.security.confirmPlaceholder')}
            placeholderTextColor={theme.colors.textMuted}
          />

          {error ? (
            <Text
              testID="settings-pin-error"
              accessibilityRole="alert"
              style={[
                styles.error,
                {
                  color: theme.colors.danger,
                  fontSize: theme.typography.fontSizes.sm,
                  marginTop: theme.spacing.sm,
                },
              ]}>
              {error}
            </Text>
          ) : null}

          <View style={[styles.row, { marginTop: theme.spacing.md }]}>
            <TouchableOpacity
              testID="settings-pin-save"
              accessibilityRole="button"
              accessibilityLabel={t('settings.security.save')}
              disabled={busy}
              onPress={onSubmit}
              style={[
                styles.button,
                {
                  backgroundColor: theme.colors.primary,
                  borderRadius: theme.spacing.sm,
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.lg,
                  marginRight: theme.spacing.sm,
                  opacity: busyOpacity,
                },
              ]}>
              <Text
                style={{
                  color: theme.colors.onPrimary,
                  fontWeight: theme.typography.fontWeights.semibold,
                }}>
                {t('settings.security.save')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="settings-pin-cancel"
              accessibilityRole="button"
              accessibilityLabel={t('settings.security.cancel')}
              disabled={busy}
              onPress={resetForm}>
              <Text
                style={{
                  color: theme.colors.primary,
                  fontWeight: theme.typography.fontWeights.semibold,
                  paddingVertical: theme.spacing.sm,
                }}>
                {t('settings.security.cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={[styles.row, { marginTop: theme.spacing.md }]}>
          <TouchableOpacity
            testID="settings-pin-set"
            accessibilityRole="button"
            accessibilityLabel={
              configured
                ? t('settings.security.change')
                : t('settings.security.set2')
            }
            onPress={() => setEditing(true)}
            style={[
              styles.button,
              {
                backgroundColor: theme.colors.primary,
                borderRadius: theme.spacing.sm,
                paddingVertical: theme.spacing.sm,
                paddingHorizontal: theme.spacing.lg,
                marginRight: theme.spacing.sm,
              },
            ]}>
            <Text
              style={{
                color: theme.colors.onPrimary,
                fontWeight: theme.typography.fontWeights.semibold,
              }}>
              {configured
                ? t('settings.security.change')
                : t('settings.security.set2')}
            </Text>
          </TouchableOpacity>

          {configured ? (
            <TouchableOpacity
              testID="settings-pin-remove"
              accessibilityRole="button"
              accessibilityLabel={t('settings.security.remove')}
              disabled={busy}
              onPress={onRemove}>
              <Text
                style={{
                  color: theme.colors.danger,
                  fontWeight: theme.typography.fontWeights.semibold,
                  paddingVertical: theme.spacing.sm,
                }}>
                {t('settings.security.remove')}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    textAlign: 'center',
    letterSpacing: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  button: {
    alignItems: 'center',
  },
  error: {},
});

export default PinSettings;
