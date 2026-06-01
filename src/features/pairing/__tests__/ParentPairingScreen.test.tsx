/**
 * Screen-level tests for ParentPairingScreen (DMY-14).
 *
 * react-native-vision-camera and react-native-permissions are mocked
 * (jest.setup.js + __mocks__). We drive the camera mock's `__emitScan` helper to
 * simulate decoded QR frames and the permissions mock to simulate grant/deny,
 * then assert the UI states (permission gate, scanning, paired, error) and the
 * store side effects.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { RESULTS, requestMultiple } from 'react-native-permissions';

import ParentPairingScreen from '../screens/ParentPairingScreen';
import {
  createPairingPayload,
  serializePairingPayload,
} from '../pairingService';
import { PAIRING_PAYLOAD_TTL_MS } from '../types';
import { lightTheme } from '../../../theme';
import { useAppStore } from '../../../store/useAppStore';

const mockRequestMultiple = requestMultiple as jest.MockedFunction<
  typeof requestMultiple
>;

// Test-only helpers live on the manual mock (__mocks__/react-native-vision-camera);
// they are not part of the real module's public types, so reach them via the mock.
const {
  __emitScan,
  __resetVisionCameraMock,
  __setMockDevice,
} = jest.requireMock('react-native-vision-camera') as {
  __emitScan: (value: string) => void;
  __resetVisionCameraMock: () => void;
  __setMockDevice: (device: unknown) => void;
};

// Test-only helpers on the zeroconf mock to drive mDNS discovery (DMY-7).
const {
  __emitResolved,
  __resetZeroconfMock,
} = jest.requireMock('react-native-zeroconf') as {
  __emitResolved: (service: unknown) => void;
  __resetZeroconfMock: () => void;
};

const DISCOVERY_PORT = 8443;

/** A QR payload that is fresh relative to real `Date.now()` (the screen uses it). */
function freshQr(): { qr: string; sessionId: string } {
  const payload = createPairingPayload(undefined, Date.now());
  return { qr: serializePairingPayload(payload), sessionId: payload.sessionId };
}

describe('ParentPairingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetVisionCameraMock();
    __resetZeroconfMock();
    act(() => useAppStore.getState().reset());
    mockRequestMultiple.mockImplementation(async (permissions: string[]) => {
      const result: Record<string, string> = {};
      for (const p of permissions) result[p] = RESULTS.GRANTED;
      return result as never;
    });
  });

  it('shows the permission gate before camera access is granted', () => {
    render(<ParentPairingScreen />);
    expect(screen.getByText('Camera access needed')).toBeTruthy();
    expect(screen.getByTestId('camera-permission-action')).toBeTruthy();
    // No camera view while ungranted.
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('requests camera permission and reveals the scanner when granted', async () => {
    render(<ParentPairingScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('camera-permission-action'));
    });

    expect(mockRequestMultiple).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('camera-view')).toBeTruthy();
    expect(screen.getByTestId('scan-hint')).toBeTruthy();
  });

  it('shows an "open Settings" affordance when camera is blocked', async () => {
    mockRequestMultiple.mockImplementation(async (permissions: string[]) => {
      const [camera, mic] = permissions;
      return { [camera]: RESULTS.BLOCKED, [mic]: RESULTS.DENIED } as never;
    });
    render(<ParentPairingScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('camera-permission-action'));
    });

    expect(screen.getByText('Open Settings')).toBeTruthy();
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('does not crash and stays on the gate when permission is denied', async () => {
    mockRequestMultiple.mockImplementation(async (permissions: string[]) => {
      const result: Record<string, string> = {};
      for (const p of permissions) result[p] = RESULTS.DENIED;
      return result as never;
    });
    render(<ParentPairingScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('camera-permission-action'));
    });

    expect(screen.getByText('Camera access needed')).toBeTruthy();
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('pairs and updates the store on a valid scan', async () => {
    const { qr, sessionId } = freshQr();
    render(<ParentPairingScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('camera-permission-action'));
    });

    act(() => {
      __emitScan(qr);
    });

    expect(screen.getByText('Paired')).toBeTruthy();
    expect(screen.getByTestId('paired-status')).toBeTruthy();
    expect(useAppStore.getState().connectionStatus).toBe('paired');
    expect(useAppStore.getState().pairedSessionId).toBe(sessionId);
  });

  it('shows an invalid-code error and does not pair on a foreign QR', async () => {
    render(<ParentPairingScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('camera-permission-action'));
    });

    act(() => {
      __emitScan('https://example.com/not-our-qr');
    });

    expect(screen.getByText(/isn’t a pairing code/i)).toBeTruthy();
    expect(screen.getByTestId('scan-error')).toBeTruthy();
    expect(screen.queryByText('Paired')).toBeNull();
    expect(useAppStore.getState().connectionStatus).toBe('idle');
    expect(useAppStore.getState().pairedSessionId).toBeNull();
  });

  it('shows an expired-code error on a stale QR', async () => {
    const stale = serializePairingPayload(
      createPairingPayload(undefined, Date.now() - PAIRING_PAYLOAD_TTL_MS - 5000),
    );
    render(<ParentPairingScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('camera-permission-action'));
    });

    act(() => {
      __emitScan(stale);
    });

    expect(screen.getByText(/has expired/i)).toBeTruthy();
    expect(useAppStore.getState().pairedSessionId).toBeNull();
  });

  it('lets the user scan again from the paired state', async () => {
    const { qr } = freshQr();
    render(<ParentPairingScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('camera-permission-action'));
    });
    act(() => __emitScan(qr));
    expect(screen.getByText('Paired')).toBeTruthy();

    fireEvent.press(screen.getByTestId('scan-again'));

    expect(screen.queryByText('Paired')).toBeNull();
    expect(screen.getByTestId('scan-hint')).toBeTruthy();
    expect(useAppStore.getState().pairedSessionId).toBeNull();
  });

  it('renders a graceful fallback when no camera device exists', async () => {
    __setMockDevice(undefined);
    render(<ParentPairingScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('camera-permission-action'));
    });

    expect(screen.getByTestId('camera-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('lists a baby-unit discovered over mDNS and pairs on tap (DMY-7)', async () => {
    const { sessionId } = freshQr();
    render(<ParentPairingScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('camera-permission-action'));
    });

    // Initially the discovery list is empty (scanning).
    expect(screen.getByTestId('discovered-empty')).toBeTruthy();

    // A baby-unit resolves on the LAN.
    act(() => {
      __emitResolved({
        name: `mbs-${sessionId.slice(0, 8)}`,
        host: '192.168.1.50',
        port: DISCOVERY_PORT,
        txt: { sid: sessionId, v: '1' },
      });
    });

    const row = screen.getByTestId(`discovered-unit-${sessionId}`);
    expect(row).toBeTruthy();

    // Tapping pairs via the discovered session id (no QR scan).
    act(() => fireEvent.press(row));

    expect(screen.getByText('Paired')).toBeTruthy();
    expect(useAppStore.getState().connectionStatus).toBe('paired');
    expect(useAppStore.getState().pairedSessionId).toBe(sessionId);
  });

  it('styles the permission gate button from design tokens', () => {
    render(<ParentPairingScreen />);
    const action = screen.getByTestId('camera-permission-action');
    const flat = Array.isArray(action.props.style)
      ? Object.assign({}, ...action.props.style)
      : action.props.style;
    expect(flat.backgroundColor).toBe(lightTheme.colors.primary);
    expect(flat.borderRadius).toBe(lightTheme.spacing.sm);
  });
});
