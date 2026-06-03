/**
 * LockScreen — the parent-mode unlock gate (DMY-10).
 *
 * Rendered in front of the parent monitoring UI when
 * `settings.biometricLockEnabled` is on. It drives {@link useBiometricAuth}:
 *  - probes the biometric sensor and shows a Face ID / Touch ID / biometric
 *    prompt automatically,
 *  - on success calls `onUnlock` (the navigator then reveals parent mode),
 *  - on decline / unavailable / error it falls back to PIN entry, verifying the
 *    PIN against the keychain-stored hash.
 *
 * All colours/typography come from design tokens via `useTheme`. No secret is
 * rendered or held longer than the input edit; the PIN field is masked.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '../../../hooks/useTheme';
import { MAX_PIN_LENGTH } from '../pinService';
import { useBiometricAuth } from '../useBiometricAuth';

export interface LockScreenProps {
  /** Called once authentication (biometric or PIN) succeeds. */
  onUnlock: () => void;
}

function LockScreen({ onUnlock }: LockScreenProps) {
  const theme = useTheme();
  const {
    stage,
    busy,
    pinConfigured,
    pinError,
    lockout,
    retryBiometric,
    usePinFallback,
    submitPin,
    clearPinError,
  } = useBiometricAuth(onUnlock);

  const [pin, setPin] = useState('');

  // Whole seconds remaining on the lockout, for the countdown copy.
  const lockoutSeconds = Math.ceil(lockout.remainingMs / 1000);

  const onChangePin = (next: string) => {
    // Digits only; bounded length. Clear any prior error on edit.
    const digits = next.replace(/[^0-9]/g, '').slice(0, MAX_PIN_LENGTH);
    setPin(digits);
    if (pinError) {
      clearPinError();
    }
  };

  const onSubmitPin = async () => {
    const ok = await submitPin(pin);
    if (!ok) {
      setPin('');
    }
  };

  // Precompute the submit button's disabled/opacity so the style object below
  // carries no literal magic value (keeps react-native/no-inline-styles happy).
  const submitDisabled =
    !pinConfigured || busy || pin.length === 0 || lockout.locked;
  const submitOpacity = submitDisabled ? 0.5 : 1;

  return (
    <View
      testID="lock-screen"
      style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.content, { paddingHorizontal: theme.spacing.xl }]}>
        <Text
          accessibilityRole="header"
          style={[
            styles.title,
            {
              color: theme.colors.text,
              fontSize: theme.typography.fontSizes.xl,
              fontWeight: theme.typography.fontWeights.bold,
              lineHeight: theme.typography.lineHeights.xl,
              marginBottom: theme.spacing.sm,
            },
          ]}>
          Parent mode is locked
        </Text>

        {(stage === 'checking' || stage === 'biometric') && (
          <View testID="lock-biometric-stage" style={styles.center}>
            <Text
              style={[
                styles.subtitle,
                {
                  color: theme.colors.textMuted,
                  fontSize: theme.typography.fontSizes.md,
                  lineHeight: theme.typography.lineHeights.md,
                  marginBottom: theme.spacing.lg,
                },
              ]}>
              Confirm it's you to view your baby.
            </Text>

            {busy ? (
              <ActivityIndicator
                testID="lock-biometric-busy"
                color={theme.colors.primary}
              />
            ) : (
              <TouchableOpacity
                accessibilityRole="button"
                testID="lock-retry-biometric"
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: theme.colors.primary,
                    borderRadius: theme.spacing.md,
                    paddingVertical: theme.spacing.md,
                    paddingHorizontal: theme.spacing.lg,
                    marginBottom: theme.spacing.md,
                  },
                ]}
                onPress={retryBiometric}>
                <Text
                  style={[
                    styles.primaryButtonText,
                    {
                      color: theme.colors.onPrimary,
                      fontSize: theme.typography.fontSizes.md,
                      fontWeight: theme.typography.fontWeights.semibold,
                    },
                  ]}>
                  Try biometrics
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              accessibilityRole="button"
              testID="lock-use-pin"
              onPress={usePinFallback}>
              <Text
                style={[
                  styles.link,
                  {
                    color: theme.colors.primary,
                    fontSize: theme.typography.fontSizes.sm,
                  },
                ]}>
                Use PIN instead
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'pin' && (
          <View testID="lock-pin-stage">
            <Text
              style={[
                styles.subtitle,
                {
                  color: theme.colors.textMuted,
                  fontSize: theme.typography.fontSizes.md,
                  lineHeight: theme.typography.lineHeights.md,
                  marginBottom: theme.spacing.lg,
                },
              ]}>
              {pinConfigured
                ? 'Enter your PIN to unlock parent mode.'
                : 'No PIN is set on this device. Set one in settings to unlock parent mode.'}
            </Text>

            <TextInput
              testID="lock-pin-input"
              accessibilityLabel="PIN"
              style={[
                styles.input,
                {
                  color: theme.colors.text,
                  backgroundColor: theme.colors.surface,
                  borderColor: pinError
                    ? theme.colors.danger
                    : theme.colors.border,
                  borderRadius: theme.spacing.md,
                  padding: theme.spacing.md,
                  fontSize: theme.typography.fontSizes.lg,
                  marginBottom: theme.spacing.sm,
                },
              ]}
              value={pin}
              onChangeText={onChangePin}
              keyboardType="number-pad"
              secureTextEntry
              editable={pinConfigured && !busy && !lockout.locked}
              maxLength={MAX_PIN_LENGTH}
              placeholder="••••"
              placeholderTextColor={theme.colors.textMuted}
              onSubmitEditing={onSubmitPin}
            />

            {lockout.locked ? (
              <Text
                testID="lock-pin-lockout"
                accessibilityRole="alert"
                style={[
                  styles.error,
                  {
                    color: theme.colors.danger,
                    fontSize: theme.typography.fontSizes.sm,
                    marginBottom: theme.spacing.sm,
                  },
                ]}>
                {`Too many attempts. Try again in ${lockoutSeconds}s.`}
              </Text>
            ) : pinError ? (
              <Text
                testID="lock-pin-error"
                style={[
                  styles.error,
                  {
                    color: theme.colors.danger,
                    fontSize: theme.typography.fontSizes.sm,
                    marginBottom: theme.spacing.sm,
                  },
                ]}>
                {lockout.attemptsRemaining > 0
                  ? `Incorrect PIN. ${lockout.attemptsRemaining} attempt${
                      lockout.attemptsRemaining === 1 ? '' : 's'
                    } left.`
                  : 'Incorrect PIN. Try again.'}
              </Text>
            ) : null}

            <TouchableOpacity
              accessibilityRole="button"
              testID="lock-submit-pin"
              disabled={submitDisabled}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: theme.colors.primary,
                  borderRadius: theme.spacing.md,
                  paddingVertical: theme.spacing.md,
                  paddingHorizontal: theme.spacing.lg,
                  marginBottom: theme.spacing.md,
                  opacity: submitOpacity,
                },
              ]}
              onPress={onSubmitPin}>
              <Text
                style={[
                  styles.primaryButtonText,
                  {
                    color: theme.colors.onPrimary,
                    fontSize: theme.typography.fontSizes.md,
                    fontWeight: theme.typography.fontWeights.semibold,
                  },
                ]}>
                Unlock
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              testID="lock-back-to-biometric"
              onPress={retryBiometric}>
              <Text
                style={[
                  styles.link,
                  {
                    color: theme.colors.primary,
                    fontSize: theme.typography.fontSizes.sm,
                  },
                ]}>
                Try biometrics
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
  },
  title: {},
  subtitle: {},
  primaryButton: {
    alignItems: 'center',
  },
  primaryButtonText: {},
  link: {
    textAlign: 'center',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    textAlign: 'center',
    letterSpacing: 8,
  },
  error: {},
});

export default LockScreen;
