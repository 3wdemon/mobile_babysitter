/**
 * SettingsScreen — the single settings surface over the app store (DMY-52).
 *
 * Every control is bound directly to a `useAppStore` action, so toggling a row
 * dispatches the matching mutator and the value persists via the store's MMKV
 * `persist` middleware (DMY-36). The screen reads `settings.theme` from the
 * store and feeds it into `useTheme`, so the chosen theme is reflected here even
 * before the global store->theme wiring lands (deliberately out of scope for the
 * theme layer, see useTheme docs).
 *
 * Controls (all store-bound):
 *  - Theme            -> setTheme('system' | 'light' | 'dark')
 *  - Alert sounds     -> toggleAlertSounds()
 *  - Noise sensitivity-> setNoiseThreshold(0..1)   (3-step segmented control)
 *  - Motion sensitivity> setMotionSensitivity(0..1) (3-step segmented control)
 *  - Biometric lock   -> setBiometricLockEnabled(boolean)
 *  - Power saver      -> setPowerSaverEnabled(boolean)
 *  - Audio-only       -> setAudioOnlyEnabled(boolean)
 *  - Role             -> setRole('baby' | 'parent')
 *  - Re-pair          -> clearPairing() (confirmed) + navigate('Pairing')
 *  - Permissions      -> hosts PermissionReRequest (DMY-57)
 *  - Diagnostics      -> navigate('Diagnostics') (DMY-62)
 *  - About            -> navigate('About') (DMY-64)
 *
 * Sensitivity sliders: there is no slider dependency in the project and adding a
 * native one (`@react-native-community/slider`) just for two scalars would mean
 * native linking for an MVP screen. Instead each scalar is exposed as a 3-step
 * segmented control (Low/Medium/High) mapping to fixed 0..1 values; the store
 * still clamps anything out of range. Note noise vs motion semantics differ:
 * for NOISE a higher threshold = LESS sensitive, for MOTION a lower threshold =
 * MORE sensitive — so each maps "Low/Medium/High sensitivity" to the right end.
 *
 * "Support development" (DMY-51): while FREE_MODE is on (MVP default) every
 * feature is free, so this is a PASSIVE "coming soon" placeholder — a static,
 * non-pressable info row with NO purchase flow / IAP. It is shown only when
 * FREE_MODE is on; once DMY-27 lands and FREE_MODE flips off, replace it with
 * the real purchase entry point.
 *
 * The presentational sub-components (Section / SwitchRow / Segmented /
 * ActionRow) are hoisted to module scope and receive `theme` as a prop so they
 * are stable across renders (no nested-component re-instantiation that would
 * drop child state such as a `Switch`).
 */
import { useCallback } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import PinSettings from '../features/auth/PinSettings';
import { FREE_MODE } from '../features/monetization';
import PermissionReRequest from '../features/onboarding/PermissionReRequest';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import type { Theme } from '../theme';
import type { RootStackScreenProps } from '../navigation/types';
import { useAppStore } from '../store/useAppStore';
import type { Role, ThemePreference } from '../store/types';

/** Theme options in display order. */
const THEME_OPTIONS: ReadonlyArray<ThemePreference> = [
  'system',
  'light',
  'dark',
];

/** Role options in display order. */
const ROLE_OPTIONS: ReadonlyArray<Exclude<Role, null>> = ['baby', 'parent'];

/**
 * 3-step sensitivity levels mapped to the underlying 0..1 scalar.
 *
 * NOISE: higher threshold = less sensitive, so "Low sensitivity" maps to a HIGH
 * threshold and "High sensitivity" to a LOW one.
 */
const NOISE_LEVELS = [
  { key: 'low', value: 0.8 },
  { key: 'medium', value: 0.6 },
  { key: 'high', value: 0.35 },
] as const;

/**
 * MOTION: lower threshold = more sensitive, so "Low sensitivity" maps to a HIGH
 * threshold and "High sensitivity" to a LOW one.
 */
const MOTION_LEVELS = [
  { key: 'low', value: 0.3 },
  { key: 'medium', value: 0.15 },
  { key: 'high', value: 0.06 },
] as const;

type SensitivityLevel = { key: string; value: number };

/**
 * Pick the level whose mapped value is nearest the persisted scalar, so the
 * segmented control always reflects the stored state (including legacy / edited
 * values that don't exactly match a step).
 */
function nearestLevelKey(
  levels: ReadonlyArray<SensitivityLevel>,
  current: number,
): string {
  let best = levels[0];
  let bestDist = Math.abs(levels[0].value - current);
  for (const level of levels) {
    const dist = Math.abs(level.value - current);
    if (dist < bestDist) {
      best = level;
      bestDist = dist;
    }
  }
  return best.key;
}

/** A labelled section heading. */
function Section({ title, theme }: { title: string; theme: Theme }) {
  return (
    <Text
      accessibilityRole="header"
      style={[
        styles.sectionTitle,
        {
          color: theme.colors.textMuted,
          fontSize: theme.typography.fontSizes.sm,
          fontWeight: theme.typography.fontWeights.semibold,
          paddingHorizontal: theme.spacing.xl,
          marginTop: theme.spacing.xl,
          marginBottom: theme.spacing.sm,
        },
      ]}
    >
      {title}
    </Text>
  );
}

/** A boolean switch row bound to a store action. */
function SwitchRow({
  testID,
  label,
  hint,
  value,
  onValueChange,
  theme,
}: {
  testID: string;
  label: string;
  hint: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  theme: Theme;
}) {
  return (
    <View style={[styles.card, styles.rowBetween, cardStyle(theme)]}>
      <View style={styles.rowText}>
        <Text style={rowLabelStyle(theme)}>{label}</Text>
        <Text style={rowHintStyle(theme)}>{hint}</Text>
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
      />
    </View>
  );
}

interface SegmentOption {
  key: string;
  text: string;
  a11y: string;
  selected: boolean;
  onPress: () => void;
}

/** A horizontal segmented control of mutually-exclusive options. */
function Segmented({
  testIDPrefix,
  label,
  hint,
  options,
  theme,
}: {
  testIDPrefix: string;
  label: string;
  hint?: string;
  options: ReadonlyArray<SegmentOption>;
  theme: Theme;
}) {
  return (
    <View style={[styles.card, cardStyle(theme)]}>
      <Text style={rowLabelStyle(theme)}>{label}</Text>
      {hint ? <Text style={rowHintStyle(theme)}>{hint}</Text> : null}
      <View style={[styles.segmented, { marginTop: theme.spacing.md }]}>
        {options.map(opt => (
          <TouchableOpacity
            key={opt.key}
            testID={`${testIDPrefix}-${opt.key}`}
            accessibilityRole="button"
            accessibilityState={{ selected: opt.selected }}
            accessibilityLabel={opt.a11y}
            onPress={opt.onPress}
            style={[
              styles.segment,
              {
                borderColor: theme.colors.border,
                borderRadius: theme.spacing.sm,
                paddingVertical: theme.spacing.sm,
                marginRight: theme.spacing.xs,
                backgroundColor: opt.selected
                  ? theme.colors.primary
                  : theme.colors.background,
              },
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                {
                  color: opt.selected
                    ? theme.colors.onPrimary
                    : theme.colors.text,
                  fontSize: theme.typography.fontSizes.sm,
                  fontWeight: theme.typography.fontWeights.semibold,
                },
              ]}
            >
              {opt.text}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/** A pressable navigation/action row. */
function ActionRow({
  testID,
  label,
  hint,
  onPress,
  destructive,
  theme,
}: {
  testID: string;
  label: string;
  hint: string;
  onPress: () => void;
  destructive?: boolean;
  theme: Theme;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.card, cardStyle(theme)]}
    >
      <Text
        style={[
          rowLabelStyle(theme),
          destructive ? { color: theme.colors.danger } : null,
        ]}
      >
        {label}
      </Text>
      <Text style={rowHintStyle(theme)}>{hint}</Text>
    </TouchableOpacity>
  );
}

/**
 * A static, non-interactive info row with an optional trailing badge. Used for
 * the "Support development — coming soon" placeholder (DMY-51): it deliberately
 * has NO onPress / purchase flow, just a label, hint and a "coming soon" badge.
 */
function InfoRow({
  testID,
  label,
  hint,
  badge,
  theme,
}: {
  testID: string;
  label: string;
  hint: string;
  badge: string;
  theme: Theme;
}) {
  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={`${label}. ${badge}. ${hint}`}
      style={[styles.card, cardStyle(theme)]}
    >
      <View style={styles.rowBetween}>
        <Text style={rowLabelStyle(theme)}>{label}</Text>
        <View
          testID={`${testID}-badge`}
          style={[
            styles.badge,
            {
              backgroundColor: theme.colors.border,
              borderRadius: theme.spacing.xs,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: theme.spacing.xs,
              marginLeft: theme.spacing.sm,
            },
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              {
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSizes.sm,
                fontWeight: theme.typography.fontWeights.semibold,
              },
            ]}
          >
            {badge}
          </Text>
        </View>
      </View>
      <Text style={rowHintStyle(theme)}>{hint}</Text>
    </View>
  );
}

// Token-driven dynamic styles (computed per theme; static layout lives in
// `styles` below).
const rowLabelStyle = (theme: Theme) => ({
  color: theme.colors.text,
  fontSize: theme.typography.fontSizes.md,
  fontWeight: theme.typography.fontWeights.semibold,
});
const rowHintStyle = (theme: Theme) => ({
  color: theme.colors.textMuted,
  fontSize: theme.typography.fontSizes.sm,
  lineHeight: theme.typography.lineHeights.sm,
  marginTop: theme.spacing.xs,
});
const cardStyle = (theme: Theme) => ({
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  marginHorizontal: theme.spacing.lg,
  borderRadius: theme.spacing.md,
  paddingHorizontal: theme.spacing.lg,
  paddingVertical: theme.spacing.md,
  marginBottom: theme.spacing.sm,
});

function SettingsScreen({ navigation }: RootStackScreenProps<'Settings'>) {
  const { t } = useTranslation();

  // Store reads (granular selectors to avoid needless re-renders).
  const themePref = useAppStore(s => s.settings.theme);
  const alertSoundsEnabled = useAppStore(s => s.settings.alertSoundsEnabled);
  const noiseThreshold = useAppStore(s => s.settings.noiseThreshold);
  const motionSensitivity = useAppStore(s => s.settings.motionSensitivity);
  const biometricLockEnabled = useAppStore(
    s => s.settings.biometricLockEnabled,
  );
  const powerSaverEnabled = useAppStore(s => s.settings.powerSaverEnabled);
  const audioOnlyEnabled = useAppStore(s => s.settings.audioOnlyEnabled);
  const role = useAppStore(s => s.role);

  // Store actions.
  const setTheme = useAppStore(s => s.setTheme);
  const toggleAlertSounds = useAppStore(s => s.toggleAlertSounds);
  const setNoiseThreshold = useAppStore(s => s.setNoiseThreshold);
  const setMotionSensitivity = useAppStore(s => s.setMotionSensitivity);
  const setBiometricLockEnabled = useAppStore(s => s.setBiometricLockEnabled);
  const setPowerSaverEnabled = useAppStore(s => s.setPowerSaverEnabled);
  const setAudioOnlyEnabled = useAppStore(s => s.setAudioOnlyEnabled);
  const setRole = useAppStore(s => s.setRole);
  const clearPairing = useAppStore(s => s.clearPairing);

  // Reflect the chosen theme on this screen itself (store->theme wiring is not
  // global yet; we pass the preference in directly).
  const theme = useTheme(themePref);

  const noiseLevelKey = nearestLevelKey(NOISE_LEVELS, noiseThreshold);
  const motionLevelKey = nearestLevelKey(MOTION_LEVELS, motionSensitivity);

  const onRePair = useCallback(() => {
    Alert.alert(
      t('settings.rePair.confirmTitle'),
      t('settings.rePair.confirmBody'),
      [
        { text: t('settings.rePair.cancel'), style: 'cancel' },
        {
          text: t('settings.rePair.confirmCta'),
          style: 'destructive',
          onPress: () => {
            clearPairing();
            navigation.navigate('Pairing');
          },
        },
      ],
    );
  }, [clearPairing, navigation, t]);

  return (
    <ScrollView
      testID="settings-screen"
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
    >
      {/* Appearance */}
      <Section title={t('settings.sections.appearance')} theme={theme} />
      <Segmented
        testIDPrefix="settings-theme"
        label={t('settings.theme.label')}
        theme={theme}
        options={THEME_OPTIONS.map(opt => ({
          key: opt,
          text: t(`settings.theme.${opt}`),
          a11y: t('settings.theme.optionA11y', {
            label: t(`settings.theme.${opt}`),
          }),
          selected: themePref === opt,
          onPress: () => setTheme(opt),
        }))}
      />

      {/* Alerts */}
      <Section title={t('settings.sections.alerts')} theme={theme} />
      <SwitchRow
        testID="settings-alert-sounds"
        label={t('settings.alertSounds.label')}
        hint={t('settings.alertSounds.hint')}
        value={alertSoundsEnabled}
        onValueChange={toggleAlertSounds}
        theme={theme}
      />

      {/* Detection */}
      <Section title={t('settings.sections.detection')} theme={theme} />
      <Segmented
        testIDPrefix="settings-noise"
        label={t('settings.noiseThreshold.label')}
        hint={t('settings.noiseThreshold.hint')}
        theme={theme}
        options={NOISE_LEVELS.map(level => ({
          key: level.key,
          text: t(`settings.noiseThreshold.${level.key}`),
          a11y: t('settings.noiseThreshold.optionA11y', {
            label: t(`settings.noiseThreshold.${level.key}`),
          }),
          selected: noiseLevelKey === level.key,
          onPress: () => setNoiseThreshold(level.value),
        }))}
      />
      <Segmented
        testIDPrefix="settings-motion"
        label={t('settings.motionSensitivity.label')}
        hint={t('settings.motionSensitivity.hint')}
        theme={theme}
        options={MOTION_LEVELS.map(level => ({
          key: level.key,
          text: t(`settings.motionSensitivity.${level.key}`),
          a11y: t('settings.motionSensitivity.optionA11y', {
            label: t(`settings.motionSensitivity.${level.key}`),
          }),
          selected: motionLevelKey === level.key,
          onPress: () => setMotionSensitivity(level.value),
        }))}
      />

      {/* Privacy & security */}
      <Section title={t('settings.sections.privacy')} theme={theme} />
      <SwitchRow
        testID="settings-biometric-lock"
        label={t('settings.biometricLock.label')}
        hint={t('settings.biometricLock.hint')}
        value={biometricLockEnabled}
        onValueChange={setBiometricLockEnabled}
        theme={theme}
      />
      {/* PIN set/change/remove + lockout state (DMY-44). Self-contained, like
          PermissionReRequest, so the screen stays declarative. */}
      <PinSettings />

      {/* Power */}
      <Section title={t('settings.sections.power')} theme={theme} />
      <SwitchRow
        testID="settings-power-saver"
        label={t('settings.powerSaver.label')}
        hint={t('settings.powerSaver.hint')}
        value={powerSaverEnabled}
        onValueChange={setPowerSaverEnabled}
        theme={theme}
      />
      <SwitchRow
        testID="settings-audio-only"
        label={t('settings.audioOnly.label')}
        hint={t('settings.audioOnly.hint')}
        value={audioOnlyEnabled}
        onValueChange={setAudioOnlyEnabled}
        theme={theme}
      />

      {/* This device */}
      <Section title={t('settings.sections.device')} theme={theme} />
      <Segmented
        testIDPrefix="settings-role"
        label={t('settings.role.label')}
        theme={theme}
        options={ROLE_OPTIONS.map(opt => ({
          key: opt,
          text: t(`settings.role.${opt}`),
          a11y: t('settings.role.optionA11y', {
            label: t(`settings.role.${opt}`),
          }),
          selected: role === opt,
          onPress: () => setRole(opt),
        }))}
      />
      <ActionRow
        testID="settings-re-pair"
        label={t('settings.rePair.label')}
        hint={t('settings.rePair.hint')}
        onPress={onRePair}
        destructive
        theme={theme}
      />

      {/* Permissions (DMY-57): self-contained re-request surface. */}
      <Section title={t('settings.sections.permissions')} theme={theme} />
      <PermissionReRequest />

      {/* Diagnostics (DMY-62) */}
      <Section title={t('settings.sections.diagnostics')} theme={theme} />
      <ActionRow
        testID="settings-diagnostics"
        label={t('settings.diagnostics.label')}
        hint={t('settings.diagnostics.hint')}
        onPress={() => navigation.navigate('Diagnostics')}
        theme={theme}
      />

      {/* Support development (DMY-51): passive "coming soon" placeholder, shown
          only while FREE_MODE is on (MVP — everything is free). No purchase
          flow; replaced by the real entry point when DMY-27 lands. */}
      {FREE_MODE ? (
        <>
          <Section title={t('settings.sections.support')} theme={theme} />
          <InfoRow
            testID="settings-support"
            label={t('settings.support.label')}
            hint={t('settings.support.hint')}
            badge={t('settings.support.badge')}
            theme={theme}
          />
        </>
      ) : null}

      {/* About (DMY-64) */}
      <Section title={t('settings.sections.about')} theme={theme} />
      <ActionRow
        testID="settings-about"
        label={t('settings.about.label')}
        hint={t('settings.about.hint')}
        onPress={() => navigation.navigate('About')}
        theme={theme}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  sectionTitle: {
    textTransform: 'uppercase',
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowText: {
    flex: 1,
    marginRight: 12,
  },
  segmented: {
    flexDirection: 'row',
  },
  segment: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentText: {
    textAlign: 'center',
  },
  badge: {
    alignSelf: 'flex-start',
  },
  badgeText: {},
});

export default SettingsScreen;
