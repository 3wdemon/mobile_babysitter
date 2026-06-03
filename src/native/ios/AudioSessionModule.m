// Objective-C bridge exposing AudioSessionModule.swift to React Native (DMY-48).
//
// RCT_EXTERN_MODULE registers the Swift class under the JS name "AudioSessionModule"
// (reachable from JS as NativeModules.AudioSessionModule). Each RCT_EXTERN_METHOD
// mirrors a Swift @objc method's selector so the bridge can route calls to it.
// Both methods are promise-returning (resolver + rejecter), so the JS side can
// await activation/teardown and the safe-wrapper can swallow a rejection.
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AudioSessionModule, NSObject)

RCT_EXTERN_METHOD(activate:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deactivate:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
