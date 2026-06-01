/**
 * Jest mock for `react-native-vision-camera` (DMY-14).
 *
 * The real library is a native Nitro module (camera session, preview, object
 * scanner) with no JS fallback under Jest. This mock reproduces only the
 * surface {@link ParentPairingScreen} uses:
 *
 *  - `useCameraDevice(position)` — returns a stub device by default; tests can
 *    override via `__setMockDevice(undefined)` to exercise the no-camera path.
 *  - `usePreviewOutput()` / `useObjectOutput({ onObjectsScanned })` — return
 *    stub output objects. The object output captures the latest
 *    `onObjectsScanned` callback so tests can drive a scan via
 *    `__emitScan(value)`.
 *  - `<Camera>` — a plain RN `View` (testID="camera-view") so the screen mounts.
 *  - `isScannedCode` — mirrors the real predicate (`'value' in object`).
 *
 * Tests assert the validation/store flow by emitting decoded strings through
 * `__emitScan`, never by touching native code.
 */
import React from 'react';
import { View } from 'react-native';

export type ScannedObjectType =
  | 'qr'
  | 'aztec'
  | 'data-matrix'
  | 'pdf-417'
  | 'unknown';

export interface ScannedObject {
  type: ScannedObjectType;
}
export interface ScannedCode extends ScannedObject {
  value?: string;
}

interface MockState {
  device: unknown;
  onObjectsScanned?: (objects: ScannedObject[]) => void;
}

const globalRef = globalThis as typeof globalThis & {
  __VISION_CAMERA_MOCK__?: MockState;
};

const state: MockState =
  globalRef.__VISION_CAMERA_MOCK__ ??
  (globalRef.__VISION_CAMERA_MOCK__ = {
    device: { id: 'mock-back-camera', position: 'back' },
    onObjectsScanned: undefined,
  });

/** Test helper: set (or clear, with `undefined`) the device returned by the hook. */
export function __setMockDevice(device: unknown): void {
  state.device = device;
}

/** Test helper: reset the mock to its defaults between tests. */
export function __resetVisionCameraMock(): void {
  state.device = { id: 'mock-back-camera', position: 'back' };
  state.onObjectsScanned = undefined;
}

/** Test helper: emit a decoded QR `value` through the registered callback. */
export function __emitScan(value: string): void {
  state.onObjectsScanned?.([{ type: 'qr', value } as ScannedCode]);
}

/** Test helper: emit a non-code object (e.g. a face) — should be ignored. */
export function __emitNonCode(): void {
  state.onObjectsScanned?.([{ type: 'unknown' } as ScannedObject]);
}

export function useCameraDevice(_position: string): unknown {
  return state.device;
}

export function usePreviewOutput(): { __type: 'preview' } {
  return { __type: 'preview' };
}

export function useObjectOutput({
  onObjectsScanned,
}: {
  types: ScannedObjectType[];
  onObjectsScanned?: (objects: ScannedObject[]) => void;
}): { __type: 'object' } {
  state.onObjectsScanned = onObjectsScanned;
  return { __type: 'object' };
}

export function isScannedCode(object: ScannedObject): object is ScannedCode {
  return 'value' in object;
}

export function isScannedFace(object: ScannedObject): boolean {
  return 'faceID' in object;
}

export function Camera(props: { testID?: string }): React.ReactElement {
  return <View testID={props.testID ?? 'camera-view'} />;
}

export const VisionCamera = {};
