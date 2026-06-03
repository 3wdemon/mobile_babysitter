// Objective-C bridge exposing SignalingServer.swift to React Native (DMY-72).
//
// RCT_EXTERN_MODULE registers the Swift class under the JS name "SignalingServer"
// (reachable as NativeModules.SignalingServer). The class is an RCTEventEmitter,
// so it emits the SignalingServer* events the JS wrapper subscribes to via a
// NativeEventEmitter. Each RCT_EXTERN_METHOD mirrors a Swift @objc selector:
//   - start(params, resolve, reject)  → bind + listen, resolves bound port
//   - send(clientId, message)         → text-frame one parent (best-effort)
//   - closeClient(clientId)           → close one parent socket
//   - stop(resolve, reject)           → tear the listener + all sockets down
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(SignalingServer, RCTEventEmitter)

RCT_EXTERN_METHOD(start:(NSDictionary *)params
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(send:(NSString *)clientId
                  message:(NSString *)message)

RCT_EXTERN_METHOD(closeClient:(NSString *)clientId)

RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
