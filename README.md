# Mobile Babysitter

P2P baby monitor app: 2 смартфона, без облачной зависимости, privacy-first.

See [`product-spec.md`](./product-spec.md) for the full product description and
[`CLAUDE.md`](./CLAUDE.md) for stack decisions and conventions.

## Stack

React Native **bare** (no Expo) + TypeScript. See `CLAUDE.md` for the full
rationale (decision DMY-5).

- React Native: 0.85.3
- Node: 22 LTS (pinned via `.nvmrc`; `engines.node >= 22.11.0`)
- iOS deployment target: 14.0+
- Android `minSdkVersion`: 26 (Android 8.0)

## Getting started

```sh
# Install JS dependencies
npm install

# iOS — install native pods (requires full Xcode + CocoaPods)
cd ios && bundle install && bundle exec pod install && cd ..

# Run
npm run start        # Metro bundler
npm run ios          # build & run on iOS simulator
npm run android      # build & run on Android emulator/device
```

## Project structure

```
src/
  components/   # Reusable UI components
  screens/      # App screens
  features/     # Business features
    pairing/    #   QR pairing
    webrtc/     #   P2P video/audio
    ml/         #   on-device cry/motion detection
    alerts/     #   push & local alerts
  services/     # Service layer (api, storage, push)
  hooks/        # Custom React hooks
  types/        # TS types
  utils/        # Utilities
  native/       # Native bridges (Swift/Kotlin)
__tests__/      # Unit tests
```

## Scripts

| Command | Description |
|---|---|
| `npm run start` | Start Metro |
| `npm run ios` | Build & run iOS |
| `npm run android` | Build & run Android |
| `npm run lint` | ESLint |
| `npm test` | Jest |
