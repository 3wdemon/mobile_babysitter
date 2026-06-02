/**
 * Static app identity used by user-facing surfaces (e.g. the About screen).
 *
 * Version source decision (DMY-64): we deliberately do NOT pull in
 * `react-native-device-info` (a native dependency) just to read a version
 * string for a placeholder About screen. The value mirrors `package.json`
 * `version` — the single source of truth for the JS package — and is kept in
 * sync by release tooling later. When a richer build identity is needed
 * (build number, native bundle version), revisit and introduce a proper
 * version provider in its own issue rather than scattering native reads.
 *
 * `APP_NAME` mirrors `app.json` `displayName`.
 */

/** Human-readable app name (mirrors app.json `displayName`). */
export const APP_NAME = 'Mobile Babysitter';

/** App version (mirrors package.json `version`). */
export const APP_VERSION = '0.0.1';
