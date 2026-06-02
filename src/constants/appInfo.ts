/**
 * Static app identity used by user-facing surfaces (e.g. the About screen).
 *
 * Version source decision (DMY-64): we deliberately do NOT pull in
 * `react-native-device-info` (a native dependency) just to read a version
 * string for a placeholder About screen. Instead `APP_VERSION` is imported
 * straight from `package.json` `version` (the single source of truth for the
 * JS package), so there is no hand-sync drift. When a richer build identity is
 * needed (build number, native bundle version), revisit and introduce a proper
 * version provider in its own issue rather than scattering native reads.
 */
import { version } from '../../package.json';

/**
 * Human-readable presentation name shown to users (intentionally spaced).
 *
 * NOTE: this is NOT the bundle `displayName` from `app.json` (which is
 * `MobileBabysitter`, no space) — it is the marketing/presentation spelling
 * and is maintained independently. Do not assume the two are kept in sync.
 */
export const APP_NAME = 'Mobile Babysitter';

/** App version. Imported from package.json `version` so it stays self-syncing. */
export const APP_VERSION = version;
