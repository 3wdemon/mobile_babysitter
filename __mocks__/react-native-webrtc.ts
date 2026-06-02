/**
 * Jest mock for `react-native-webrtc` (DMY-16).
 *
 * The real library is a native module (no JS fallback under Jest). The
 * signalling layer abstracts `RTCPeerConnection` behind the `PeerConnection`
 * wrapper, and most unit tests inject a mock PeerConnection / mock ctor
 * directly. This mock exists so that:
 *   - importing the webrtc feature index under Jest does not blow up, and
 *   - the `createPeerConnection` wrapper can be exercised against a controllable
 *     fake `RTCPeerConnection` whose offer/answer/ICE/state events are driven by
 *     the test via the `__*` helpers below.
 *
 * No real media, network, or SDP is produced — `createOffer`/`createAnswer`
 * return placeholder descriptions and all events are fired manually.
 */

interface MockHandlers {
  onicecandidate:
    | ((event: { candidate: unknown }) => void)
    | null;
  onconnectionstatechange: ((event?: unknown) => void) | null;
  oniceconnectionstatechange: ((event?: unknown) => void) | null;
  ontrack: ((event: unknown) => void) | null;
}

export class RTCPeerConnection {
  connectionState = 'new';
  iceConnectionState = 'new';
  onicecandidate: MockHandlers['onicecandidate'] = null;
  onconnectionstatechange: MockHandlers['onconnectionstatechange'] = null;
  oniceconnectionstatechange: MockHandlers['oniceconnectionstatechange'] = null;
  ontrack: MockHandlers['ontrack'] = null;

  readonly config: unknown;

  constructor(config?: unknown) {
    this.config = config;
  }

  createOffer = jest.fn(async () => ({ type: 'offer', sdp: 'mock-offer-sdp' }));
  createAnswer = jest.fn(async () => ({
    type: 'answer',
    sdp: 'mock-answer-sdp',
  }));
  setLocalDescription = jest.fn(async () => {});
  setRemoteDescription = jest.fn(async () => {});
  addIceCandidate = jest.fn(async () => {});
  close = jest.fn(() => {
    this.connectionState = 'closed';
  });

  /** @internal Drive a connection-state change. */
  __setConnectionState(state: string): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  /** @internal Emit a local ICE candidate (null = end-of-candidates). */
  __emitIceCandidate(candidate: unknown): void {
    this.onicecandidate?.({ candidate });
  }
}

export class RTCSessionDescription {
  type: string;
  sdp: string;
  constructor(init: { type: string; sdp: string }) {
    this.type = init.type;
    this.sdp = init.sdp;
  }
}

export class RTCIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  constructor(init: {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
  }) {
    this.candidate = init.candidate;
    this.sdpMid = init.sdpMid ?? null;
    this.sdpMLineIndex = init.sdpMLineIndex ?? null;
  }
}

export const mediaDevices = {
  getUserMedia: jest.fn(async () => ({ getTracks: () => [] })),
};

/**
 * Mock `RTCView` (DMY-17). The real one is a native host component that renders
 * a remote/local video stream; under Jest we render a plain RN `View` carrying
 * the same `streamURL`/`testID` props so a test can assert the view is mounted
 * with the right stream id without any native surface.
 */
const React = require('react');
const { View } = require('react-native');
export const RTCView = (props: { streamURL?: string; testID?: string }) =>
  React.createElement(View, props);

export default {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  RTCView,
};
