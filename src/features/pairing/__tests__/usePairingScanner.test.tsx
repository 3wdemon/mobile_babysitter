/**
 * Unit tests for usePairingScanner (DMY-14).
 *
 * Drive the (native-free) scan handler with decoded QR strings and assert:
 *  - a valid, fresh QR -> `paired`, store updated (pairedSessionId + status),
 *  - an invalid/garbage QR -> `error` (reason 'invalid'), store untouched,
 *  - a stale QR -> `error` (reason 'stale'), store untouched,
 *  - the scanner locks after pairing (further scans ignored) and `reset`
 *    returns to `scanning` and clears the store pairing,
 *  - nothing ever throws.
 */
import { act, renderHook } from '@testing-library/react-native';

import {
  createPairingPayload,
  serializePairingPayload,
} from '../pairingService';
import { PAIRING_PAYLOAD_TTL_MS } from '../types';
import { usePairingScanner } from '../usePairingScanner';
import { useAppStore } from '../../../store/useAppStore';

const NOW = 1_700_000_000_000;
const now = () => NOW;

function freshQr(at: number = NOW): string {
  return serializePairingPayload(createPairingPayload(undefined, at));
}

function storeSnapshot() {
  const s = useAppStore.getState();
  return {
    connectionStatus: s.connectionStatus,
    pairedSessionId: s.pairedSessionId,
  };
}

describe('usePairingScanner', () => {
  beforeEach(() => {
    act(() => useAppStore.getState().reset());
  });

  it('starts in scanning state with no session or error', () => {
    const { result } = renderHook(() => usePairingScanner(now));
    expect(result.current.status).toBe('scanning');
    expect(result.current.sessionId).toBeNull();
    expect(result.current.errorReason).toBeNull();
  });

  it('pairs on a valid fresh QR and updates the store', () => {
    const payload = createPairingPayload(undefined, NOW);
    const qr = serializePairingPayload(payload);

    const { result } = renderHook(() => usePairingScanner(now));
    act(() => {
      result.current.onScan(qr);
    });

    expect(result.current.status).toBe('paired');
    expect(result.current.sessionId).toBe(payload.sessionId);
    expect(result.current.errorReason).toBeNull();
    expect(storeSnapshot()).toEqual({
      connectionStatus: 'paired',
      pairedSessionId: payload.sessionId,
    });
  });

  it('does NOT advance to connected (signalling is pending / DMY-16)', () => {
    const { result } = renderHook(() => usePairingScanner(now));
    act(() => {
      result.current.onScan(freshQr());
    });
    // Honest intermediate state: paired, not connected.
    expect(useAppStore.getState().connectionStatus).toBe('paired');
    expect(useAppStore.getState().connectionStatus).not.toBe('connected');
  });

  it('reports an error and does not pair on garbage input', () => {
    const { result } = renderHook(() => usePairingScanner(now));
    act(() => {
      result.current.onScan('{not a qr');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorReason).toBe('invalid');
    expect(result.current.sessionId).toBeNull();
    expect(storeSnapshot()).toEqual({
      connectionStatus: 'idle',
      pairedSessionId: null,
    });
  });

  it('reports a stale error and does not pair on an expired QR', () => {
    const expired = freshQr(NOW - PAIRING_PAYLOAD_TTL_MS - 1000);
    const { result } = renderHook(() => usePairingScanner(now));
    act(() => {
      result.current.onScan(expired);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorReason).toBe('stale');
    expect(storeSnapshot()).toEqual({
      connectionStatus: 'idle',
      pairedSessionId: null,
    });
  });

  it('locks after pairing — further scans are ignored', () => {
    const first = createPairingPayload(undefined, NOW);
    const second = createPairingPayload(undefined, NOW);

    const { result } = renderHook(() => usePairingScanner(now));
    act(() => {
      result.current.onScan(serializePairingPayload(first));
    });
    expect(result.current.sessionId).toBe(first.sessionId);

    // A subsequent (even garbage) scan must not change anything.
    act(() => {
      result.current.onScan('{garbage');
      result.current.onScan(serializePairingPayload(second));
    });
    expect(result.current.status).toBe('paired');
    expect(result.current.sessionId).toBe(first.sessionId);
  });

  it('reset returns to scanning and clears the store pairing', () => {
    const { result } = renderHook(() => usePairingScanner(now));
    act(() => {
      result.current.onScan(freshQr());
    });
    expect(result.current.status).toBe('paired');

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('scanning');
    expect(result.current.sessionId).toBeNull();
    expect(result.current.errorReason).toBeNull();
    expect(storeSnapshot()).toEqual({
      connectionStatus: 'idle',
      pairedSessionId: null,
    });

    // After reset, scanning works again (lock released).
    const next = createPairingPayload(undefined, NOW);
    act(() => {
      result.current.onScan(serializePairingPayload(next));
    });
    expect(result.current.status).toBe('paired');
    expect(result.current.sessionId).toBe(next.sessionId);
  });

  it('never throws on arbitrary input', () => {
    const { result } = renderHook(() => usePairingScanner(now));
    for (const junk of ['', '][', 'null', '12']) {
      expect(() =>
        act(() => {
          result.current.onScan(junk);
        }),
      ).not.toThrow();
    }
  });

  describe('pairWithSessionId (local discovery / DMY-7)', () => {
    it('pairs with a discovered session id and updates the store', () => {
      const payload = createPairingPayload(undefined, NOW);
      const { result } = renderHook(() => usePairingScanner(now));
      act(() => {
        result.current.pairWithSessionId(payload.sessionId);
      });

      expect(result.current.status).toBe('paired');
      expect(result.current.sessionId).toBe(payload.sessionId);
      expect(storeSnapshot()).toEqual({
        connectionStatus: 'paired',
        pairedSessionId: payload.sessionId,
      });
    });

    it('rejects a malformed session id without touching the store', () => {
      const { result } = renderHook(() => usePairingScanner(now));
      act(() => {
        result.current.pairWithSessionId('not-a-uuid');
      });

      expect(result.current.status).toBe('error');
      expect(result.current.errorReason).toBe('invalid');
      expect(storeSnapshot()).toEqual({
        connectionStatus: 'idle',
        pairedSessionId: null,
      });
    });

    it('is ignored once already paired (lock)', () => {
      const first = createPairingPayload(undefined, NOW);
      const second = createPairingPayload(undefined, NOW);
      const { result } = renderHook(() => usePairingScanner(now));
      act(() => result.current.pairWithSessionId(first.sessionId));
      act(() => result.current.pairWithSessionId(second.sessionId));
      expect(result.current.sessionId).toBe(first.sessionId);
    });
  });
});
