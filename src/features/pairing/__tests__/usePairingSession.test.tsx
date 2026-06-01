/**
 * Unit tests for usePairingSession (DMY-6).
 *
 * Cover: a fresh session is created on mount, qrValue round-trips to a valid
 * payload, regenerate mints a NEW session id (invalidating the old QR), and the
 * logger only ever receives the non-sensitive session id (never the serialized
 * QR / connection material).
 */
import { act, renderHook } from '@testing-library/react-native';

import { usePairingSession } from '../usePairingSession';
import { parsePairingPayload } from '../pairingService';
import { logger } from '../../../services/logger';

describe('usePairingSession', () => {
  it('creates a session with a valid, serializable payload on mount', () => {
    const { result } = renderHook(() => usePairingSession());

    expect(result.current.payload.sessionId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    const parsed = parsePairingPayload(result.current.qrValue);
    expect(parsed).toEqual(result.current.payload);
  });

  it('keeps the same session across re-renders (no regenerate)', () => {
    const { result, rerender } = renderHook(() => usePairingSession());
    const first = result.current.payload.sessionId;
    rerender({});
    expect(result.current.payload.sessionId).toBe(first);
  });

  it('regenerate mints a new session id and a new qrValue', () => {
    const { result } = renderHook(() => usePairingSession());
    const before = result.current.payload.sessionId;
    const beforeQr = result.current.qrValue;

    act(() => {
      result.current.regenerate();
    });

    expect(result.current.payload.sessionId).not.toBe(before);
    expect(result.current.qrValue).not.toBe(beforeQr);
    expect(parsePairingPayload(result.current.qrValue)).toEqual(
      result.current.payload,
    );
  });

  it('logs only the session id — never the serialized QR / connection material', () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => usePairingSession());
      act(() => {
        result.current.regenerate();
      });

      expect(infoSpy).toHaveBeenCalled();
      for (const call of infoSpy.mock.calls) {
        const serialized = JSON.stringify(call);
        // The full QR string must never be passed to the logger.
        expect(serialized).not.toContain(result.current.qrValue);
        // Each log payload carries a sessionId field and nothing connection-y.
        const meta = call[1] as Record<string, unknown> | undefined;
        if (meta) {
          expect(Object.keys(meta)).toEqual(['sessionId']);
        }
      }
    } finally {
      infoSpy.mockRestore();
    }
  });
});
