/** @type {Detox.DetoxConfig} */
module.exports = {
  // Detox drives its own Jest runner (separate from the unit Jest at
  // jest.config.js and from Playwright at tests/e2e). Config + setup live under
  // tests/detox so the three test stacks never collide.
  testRunner: {
    args: {
      $0: 'jest',
      config: 'tests/detox/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      // Built into Xcode DerivedData; adjust if a custom build dir is set.
      binaryPath:
        'ios/build/Build/Products/Debug-iphonesimulator/MobileBabysitter.app',
      build:
        'xcodebuild -workspace ios/MobileBabysitter.xcworkspace -scheme MobileBabysitter -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
      bundleId: 'app.mobilebabysitter',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build:
        'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug && cd ..',
      testBinaryPath:
        'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk',
      package: 'com.mobilebabysitter',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 17',
      },
    },
    emulator: {
      type: 'android.emulator',
      device: {
        avdName: 'babysitter_api36',
      },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
  },
};
