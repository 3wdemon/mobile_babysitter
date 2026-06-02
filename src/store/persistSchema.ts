/**
 * Persisted-state schema + hardened hydration helpers (DMY-43).
 *
 * The zustand `persist` middleware reads whatever JSON happens to be on disk and
 * hands it to `merge`. That blob is fully untrusted: it can be
 *  - missing entirely (first launch),
 *  - a previous app version's shape (fields added/removed since),
 *  - partial (a write interrupted mid-flight), or
 *  - outright corrupt (manual tampering, storage bit-rot, a non-JSON value).
 *
 * Historically `useAppStore` defended against this with a hand-rolled shallow
 * deep-merge that only backfilled the two nested objects it knew about
 * (`settings`, `freeTierUsage`). That left holes: a persisted `role: 12345` or a
 * `settings.theme: "neon"` would survive into runtime state as an invalid value,
 * and any *new* nested field added later needed another manual merge line.
 *
 * This module replaces that with a single source of truth: a Zod schema that
 * mirrors {@link PersistedState}. {@link parsePersistedState} validates the raw
 * blob field-by-field, repairs/drops anything that does not match, and
 * deep-merges the survivors over the supplied defaults. The result is ALWAYS a
 * complete, valid {@link PersistedState} — a corrupt or partial blob can never
 * crash the app or leak an out-of-range value into the store.
 *
 * Design choices:
 *  - **Per-field resilience over all-or-nothing.** We deep-merge the raw blob
 *    over the defaults BEFORE parsing, then use `.catch(default)` on each leaf,
 *    so a single bad field (e.g. a tampered `theme`) falls back to its default
 *    while the rest of a valid blob is preserved. A whole-object reject would
 *    needlessly discard good data.
 *  - **No I/O, no React, framework-free.** Pure functions over plain objects so
 *    the behaviour is exhaustively unit-testable without MMKV or zustand.
 *  - **Privacy.** Nothing here logs or stores user content; on a parse fallback
 *    we emit a single redaction-safe warning via the app logger, never the blob.
 */
import { z } from 'zod';

import { EMPTY_QUOTA } from '../features/monetization/freeTierQuota';
import { logger } from '../services/logger';
import type { PersistedState, Settings } from './types';

/**
 * Canonical defaults for the persisted slice.
 *
 * Exported so both the store's initial state and the schema's per-field
 * fallbacks draw from ONE source of truth — there is no second place to update
 * when a default changes.
 */
export const DEFAULT_PERSISTED_STATE: PersistedState = {
  role: null,
  onboardingCompleted: false,
  settings: {
    theme: 'system',
    alertSoundsEnabled: true,
    // Mirrors DEFAULT_NOISE_CONFIG.enterThreshold in features/detection (DMY-8).
    noiseThreshold: 0.6,
    // Mirrors DEFAULT_MOTION_CONFIG.enterThreshold in features/detection (DMY-25).
    motionSensitivity: 0.15,
    biometricLockEnabled: false,
    isPremium: false,
    powerSaverEnabled: true,
    audioOnlyEnabled: true,
  },
  freeTierUsage: { ...EMPTY_QUOTA },
};

const DEFAULT_SETTINGS = DEFAULT_PERSISTED_STATE.settings;

/**
 * A 0..1 scalar (inclusive). Non-finite or out-of-range values fall back to the
 * caller-supplied default rather than poisoning detection thresholds.
 */
const unitScalar = (fallback: number) =>
  z.number().finite().min(0).max(1).catch(fallback);

/**
 * Schema for {@link Settings}. Each leaf carries its own `.catch(default)` so a
 * single malformed field is repaired in place while valid siblings survive.
 */
const settingsSchema: z.ZodType<Settings> = z.object({
  theme: z.enum(['system', 'light', 'dark']).catch(DEFAULT_SETTINGS.theme),
  alertSoundsEnabled: z.boolean().catch(DEFAULT_SETTINGS.alertSoundsEnabled),
  noiseThreshold: unitScalar(DEFAULT_SETTINGS.noiseThreshold),
  motionSensitivity: unitScalar(DEFAULT_SETTINGS.motionSensitivity),
  biometricLockEnabled: z
    .boolean()
    .catch(DEFAULT_SETTINGS.biometricLockEnabled),
  isPremium: z.boolean().catch(DEFAULT_SETTINGS.isPremium),
  powerSaverEnabled: z.boolean().catch(DEFAULT_SETTINGS.powerSaverEnabled),
  audioOnlyEnabled: z.boolean().catch(DEFAULT_SETTINGS.audioOnlyEnabled),
});

/**
 * Schema for {@link FreeTierUsage}. `usedMs` must be a finite, non-negative
 * number; `dateKey` is either a `YYYY-MM-DD` string or `null`. Anything else is
 * repaired to the empty quota's field default.
 */
const freeTierUsageSchema: z.ZodType<PersistedState['freeTierUsage']> =
  z.object({
    usedMs: z.number().finite().min(0).catch(EMPTY_QUOTA.usedMs),
    dateKey: z
      .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
      .catch(EMPTY_QUOTA.dateKey),
  });

/** Role schema: `'baby' | 'parent' | null`. */
const roleSchema = z.enum(['baby', 'parent']).nullable();

/**
 * Plain-object guard. Arrays and `null` are objects to `typeof` but are not
 * valid nested-state shapes, so we exclude them explicitly.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep-merge a raw nested object over its defaults, then validate with `schema`.
 * Each leaf's `.catch` repairs an individual bad field; if the whole object is
 * non-object garbage we parse the defaults alone (always valid).
 */
function mergeAndParse<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  defaults: T & object,
): T {
  const candidate = isPlainObject(raw) ? { ...defaults, ...raw } : defaults;
  const result = schema.safeParse(candidate);
  // The leaf `.catch`es make a successful parse the norm; the fallback to a
  // fresh clone of the defaults is a last-resort guard that should never fire.
  return result.success ? result.data : { ...defaults };
}

/**
 * Validate, repair and deep-merge an untrusted persisted blob into a complete,
 * valid {@link PersistedState}.
 *
 * Resolution order for every field:
 *  1. If the persisted value is present and schema-valid, keep it.
 *  2. Otherwise fall back to the corresponding `defaults` field.
 *
 * Because nested objects are deep-merged over the defaults before parsing and
 * each leaf is independently `.catch`-guarded, a partial blob is merged with the
 * defaults (valid fields preserved, missing/invalid ones backfilled) and a
 * wholly-corrupt blob degrades to a clone of `defaults`.
 *
 * @param raw      Untrusted value from disk (already JSON-parsed by zustand, or
 *                 `undefined`/`null` when absent or unparseable).
 * @param defaults The store's initial persisted state to merge over. Defaults to
 *                 {@link DEFAULT_PERSISTED_STATE}; injectable for tests.
 * @returns A new, fully-populated, schema-valid `PersistedState`.
 */
export function parsePersistedState(
  raw: unknown,
  defaults: PersistedState = DEFAULT_PERSISTED_STATE,
): PersistedState {
  // Absent or non-object blob: nothing to recover, use defaults verbatim.
  if (!isPlainObject(raw)) {
    if (raw !== undefined && raw !== null) {
      // A present-but-non-object value (e.g. a bare string/number/array) is a
      // real shape mismatch worth a breadcrumb; the value itself is not logged.
      logger.warn(
        'persist hydration: persisted state was not an object; using defaults',
      );
    }
    return cloneDefaults(defaults);
  }

  return {
    role: parseField(roleSchema, raw.role, defaults.role),
    onboardingCompleted: parseField(
      z.boolean(),
      raw.onboardingCompleted,
      defaults.onboardingCompleted,
    ),
    settings: mergeAndParse(settingsSchema, raw.settings, defaults.settings),
    freeTierUsage: mergeAndParse(
      freeTierUsageSchema,
      raw.freeTierUsage,
      defaults.freeTierUsage,
    ),
  };
}

/** Deep clone of the defaults so callers never alias the shared constant. */
function cloneDefaults(defaults: PersistedState): PersistedState {
  return {
    role: defaults.role,
    onboardingCompleted: defaults.onboardingCompleted,
    settings: { ...defaults.settings },
    freeTierUsage: { ...defaults.freeTierUsage },
  };
}

/** Parse a single value with a schema, falling back to `fallback` on mismatch. */
function parseField<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}
