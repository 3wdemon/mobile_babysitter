/**
 * Screen integration test for the UNIFIED baby publish path (DMY-75).
 *
 * Before DMY-75 the baby ran TWO competing publishers:
 *   - the 1:1 useMediaSession responder mounted by BabyPairingScreen (DMY-45), and
 *   - the fan-out manager driven by useBabyBroadcast in BabyScreen (DMY-66).
 * With the native listener live (DMY-72) BOTH would open the camera+mic, racing
 * `getUserMedia` for the single camera. This test proves the fix end-to-end: with
 * a real (mock) multi-client transport connecting ONE parent, BabyScreen performs
 * EXACTLY ONE capture (one `getLocalVideoStream`) — the fan-out is the SOLE
 * publisher and the 1:1 path is gone. The pairing QR is still rendered.
 *
 * The capture seam {@link getLocalVideoStream} is mocked to a controllable fake
 * stream so the assertion counts capture invocations directly, independent of the
 * native `mediaDevices` resolution. The mock RTCPeerConnection (jest.setup.js) is
 * the default per-parent peer connection.
 */
import { act, render, screen } from '@testing-library/react-native';

import * as videoStream from '../../features/webrtc/videoStream';
import BabyScreen from '../BabyScreen';
import { useAppStore } from '../../store/useAppStore';
import { createLoopbackTransportPair } from '../../features/webrtc/signalingTransport';
import type { MultiClientSignalingTransport } from '../../features/webrtc/babyBroadcast';
import type {
  MediaStreamLike,
  MediaStreamTrackLike,
} from '../../features/webrtc/mediaTypes';
import type { SignalingTransport } from '../../features/webrtc/signalingTypes';
import type { RootStackScreenProps } from '../../navigation/types';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

const navProps = {} as unknown as RootStackScreenProps<'Baby'>;

/** A fake capture stream (audio+video) the fan-out can publish. */
function makeCaptureStream(): MediaStreamLike {
  const audio: MediaStreamTrackLike = { kind: 'audio', enabled: true, stop: jest.fn() };
  const video: MediaStreamTrackLike = { kind: 'video', enabled: true, stop: jest.fn() };
  return {
    getTracks: () => [audio, video],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [video],
  };
}

/**
 * A fake accept loop (the DMY-72 seam) that lets the test connect parents
 * synchronously, exactly like the fan-out unit tests.
 */
function makeBroadcastTransport() {
  let connect: ((id: string, tx: SignalingTransport) => void) | null = null;
  const transport: MultiClientSignalingTransport = {
    onClientConnect(handler) {
      connect = handler;
      return () => {
        connect = null;
      };
    },
    async start() {},
    close() {},
  };
  return {
    transport,
    connect: (id: string, tx: SignalingTransport) => connect?.(id, tx),
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

describe('BabyScreen — unified baby publish path (DMY-75)', () => {
  let captureSpy: jest.SpyInstance;

  beforeEach(() => {
    __resetAllMmkv();
    act(() => useAppStore.getState().reset());
    act(() => {
      useAppStore.getState().setRole('baby');
      useAppStore.getState().setPaired('sess-unify');
    });
    captureSpy = jest
      .spyOn(videoStream, 'getLocalVideoStream')
      .mockResolvedValue({
        stream: makeCaptureStream(),
        constraints: { width: 1280, height: 720, frameRate: 30 },
        degraded: false,
      });
  });

  afterEach(() => {
    captureSpy.mockRestore();
  });

  it('captures the camera+mic EXACTLY ONCE for a connected parent (one capture, no second session)', async () => {
    const bus = makeBroadcastTransport();

    render(<BabyScreen {...navProps} broadcastTransport={bus.transport} />);
    await flush();

    // No parent yet → the shared capture is lazy. Critically, the REMOVED 1:1
    // useMediaSession would have captured on its own peer connection here,
    // independent of the connected-parents list.
    expect(captureSpy).not.toHaveBeenCalled();

    // One parent dials in over the (fake) accept loop.
    await act(async () => {
      const { a } = createLoopbackTransportPair();
      bus.connect('parent-1', a);
      for (let i = 0; i < 8; i++) {
        await Promise.resolve();
      }
    });

    // The fan-out opened the SINGLE shared capture once — and only once. A
    // lingering 1:1 useMediaSession would have produced a SECOND capture.
    expect(captureSpy).toHaveBeenCalledTimes(1);

    // The pairing view is still mounted (BabyPairingScreen stays a pairing UI).
    expect(screen.getByText('Pair this baby unit')).toBeTruthy();
    expect(screen.getByTestId('pairing-qr')).toBeTruthy();
  });

  it('does not capture at all before any parent connects (no eager 1:1 capture)', async () => {
    const bus = makeBroadcastTransport();

    render(<BabyScreen {...navProps} broadcastTransport={bus.transport} />);
    await flush();

    // The removed 1:1 path captured as soon as the responder session went live,
    // independent of the connected-parents list. The unified path is lazy.
    expect(captureSpy).not.toHaveBeenCalled();
  });
});
