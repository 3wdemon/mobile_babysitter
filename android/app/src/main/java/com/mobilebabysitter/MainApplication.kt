package com.mobilebabysitter

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // App-local native modules that cannot be autolinked (they live in the
          // app, not an npm package) are registered manually here.
          // AudioForegroundPackage exposes the background-audio foreground service
          // (DMY-23) as NativeModules.AudioForegroundModule.
          add(AudioForegroundPackage())
          // SignalingServerPackage exposes the baby-side WebSocket signalling
          // SERVER (DMY-72) as NativeModules.SignalingServer.
          add(SignalingServerPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
