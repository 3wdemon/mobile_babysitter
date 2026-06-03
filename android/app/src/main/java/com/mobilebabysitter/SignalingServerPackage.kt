package com.mobilebabysitter

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * SignalingServerPackage — registers {@link SignalingServerModule} with React
 * Native (DMY-72). The module is app-local (not an npm package), so it cannot be
 * autolinked; it is added manually in {@link MainApplication}'s package list.
 * No native UI, so no view managers.
 */
class SignalingServerPackage : ReactPackage {

  override fun createNativeModules(
    reactContext: ReactApplicationContext,
  ): List<NativeModule> = listOf(SignalingServerModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
