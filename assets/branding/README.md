# Branding assets — PLACEHOLDER (DMY-58)

These are **placeholder** assets, **not** the final brand. They exist so the app
ships a recognisable icon + splash during MVP development and are meant to be
replaced once real brand design lands.

| File | Purpose |
|---|---|
| `app-icon.svg` | Master for the launcher / home-screen icon: brand-blue (`#2F6FED`, theme `primary`) field, white `MB` monogram, `PLACEHOLDER` marker. |
| `bootsplash-logo.svg` | Master for the launch splash logo: white `MB` monogram on the splash background (`#2F6FED`). |

## Regenerating

Both flows are reproducible from the SVGs above.

**App icon** (iOS `AppIcon.appiconset` + Android `mipmap-*`):

```sh
node scripts/generate-app-icon.mjs
```

**Splash** (react-native-bootsplash native config + `assets/bootsplash/`):

```sh
node node_modules/react-native-bootsplash/cli.js generate \
  assets/branding/bootsplash-logo.svg \
  --platforms android,ios \
  --background "#2F6FED" \
  --logo-width 100 \
  --assets-output assets/bootsplash
```

## Replacing with final brand

1. Drop the real icon/logo into this folder (keep the filenames or update the
   commands above).
2. Re-run both generators.
3. Remove the `PLACEHOLDER` marker text from `app-icon.svg`.
