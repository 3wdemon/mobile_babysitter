package com.mobilebabysitter

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * AudioForegroundPackage — registers {@link AudioForegroundModule} with React
 * Native (DMY-23). This module cannot be autolinked (it lives in the app, not in
 * an npm package), so it is added manually in {@link MainApplication}'s package
 * list. No native UI, so no view managers.
 */
class AudioForegroundPackage : ReactPackage {

  override fun createNativeModules(
    reactContext: ReactApplicationContext,
  ): List<NativeModule> = listOf(AudioForegroundModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
