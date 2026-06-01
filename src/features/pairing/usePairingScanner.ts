/**
 * usePairingScanner — parent-unit QR scan handling (DMY-14).
 *
 * The native camera layer (react-native-vision-camera, in
 * {@link ParentPairingScreen}) decodes QR frames and hands the raw string to
 * {@link UsePairingScanner.onScan}. This hook owns the PURE, native-free part of
 * scanning so it can be unit-tested without a camera:
 *
 *   raw QR string
 *     -> {@link validateScannedPayload} (parse + freshness/connection checks)
 *     -> success: record `paired` (sessionId + connectionStatus) in the store
 *        and surface a `paired` status;
 *     -> failure: surface an `error` status with a reason (`invalid` | `stale`),
 *        WITHOUT touching the store and WITHOUT throwing.
 *
 * Scanning is a high-frequency callback (many frames/sec). To avoid thrashing,
 * once we reach `paired` we LOCK and ignore further scans until {@link reset}.
 * Repeated identical errors are deduped so the UI does not flicker.
 *
 * IMPORTANT (scope): a successful scan means "paired", NOT "connected". The real
 * WebRTC signalling handshake (offer/answer + ICE) is DMY-16/18. The TODO hook
 * below marks exactly where that kicks off. We never fake a live connection.
 */
import { useCallback, useRef, useState } from 'react';

import { logger } from '../../services/logger';
import { useAppStore } from '../../store/useAppStore';
import { isValidSessionId, validateScannedPayload } from './pairingService';
import type { PairingScanRejectReason } from './types';

/** UI-facing scan state. */
export type PairingScanStatus = 'scanning' | 'paired' | 'error';

/** Value returned by {@link usePairingScanner}. */
export interface UsePairingScanner {
  /** Current scan state for the UI to render. */
  readonly status: PairingScanStatus;
  /** The sessionId we paired with, once `status === 'paired'`; else `null`. */
  readonly sessionId: string | null;
  /** Why the last scan failed, when `status === 'error'`; else `null`. */
  readonly errorReason: PairingScanRejectReason | null;
  /**
   * Feed a decoded QR string. Never throws. Ignored once paired (until
   * {@link reset}). Returns the resulting status so callers/tests can assert
   * synchronously.
   */
  readonly onScan: (raw: string) => PairingScanStatus;
  /**
   * Pair directly with a `sessionId` discovered out-of-band — e.g. a baby-unit
   * found over mDNS/Bonjour on the LAN (DMY-7) rather than via a scanned QR.
   * Records the SAME `paired` state as a successful scan (sessionId +
   * `connectionStatus: 'paired'`) and locks the scanner. The id is validated as
   * a UUID v4; a malformed id surfaces an `invalid` error WITHOUT touching the
   * store. Never throws. Ignored once already paired (until {@link reset}).
   */
  readonly pairWithSessionId: (sessionId: string) => PairingScanStatus;
  /** Return to `scanning`, clearing any error/paired state and the store pairing. */
  readonly reset: () => void;
}

/**
 * @param now Injectable clock (epoch ms) for deterministic freshness tests.
 *   Defaults to `Date.now()` evaluated per-scan.
 */
export function usePairingScanner(now?: () => number): UsePairingScanner {
  const setPaired = useAppStore(s => s.setPaired);
  const clearPairing = useAppStore(s => s.clearPairing);

  const [status, setStatus] = useState<PairingScanStatus>('scanning');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errorReason, setErrorReason] =
    useState<PairingScanRejectReason | null>(null);

  // Locked once paired so the rapid scan callback stops processing frames.
  const lockedRef = useRef(false);

  const onScan = useCallback(
    (raw: string): PairingScanStatus => {
      if (lockedRef.current) {
        return 'paired';
      }

      const result = validateScannedPayload(raw, now ? now() : Date.now());

      if (result.ok) {
        lockedRef.current = true;
        // Log only the non-sensitive session id (never the raw QR / SDP/ICE).
        logger.info('pairing: parent scanned valid QR', {
          sessionId: result.payload.sessionId,
        });
        setPaired(result.payload.sessionId);
        setSessionId(result.payload.sessionId);
        setErrorReason(null);
        setStatus('paired');

        // TODO(DMY-16/18): start the WebRTC signalling handshake here using
        // result.payload (sessionId + connection). On success the store's
        // connectionStatus advances paired -> connecting -> connected. Until
        // then we remain honestly at "paired (signalling pending)".

        return 'paired';
      }

      // Invalid/stale QR: surface the reason, leave the store untouched, keep
      // scanning. Do NOT log the raw value (could be a foreign/secret QR).
      logger.warn('pairing: parent rejected scanned QR', {
        reason: result.reason,
      });
      setErrorReason(result.reason);
      setStatus('error');
      return 'error';
    },
    [now, setPaired],
  );

  const pairWithSessionId = useCallback(
    (id: string): PairingScanStatus => {
      if (lockedRef.current) {
        return 'paired';
      }
      if (!isValidSessionId(id)) {
        // A discovered unit with a malformed id is not one of ours — surface an
        // invalid error, leave the store untouched, keep scanning.
        logger.warn('pairing: rejected discovered session id', {
          reason: 'invalid',
        });
        setErrorReason('invalid');
        setStatus('error');
        return 'error';
      }

      lockedRef.current = true;
      // sessionId is masked by the redacting logger (exact redactor key).
      logger.info('pairing: parent paired via local discovery', {
        sessionId: id,
      });
      setPaired(id);
      setSessionId(id);
      setErrorReason(null);
      setStatus('paired');

      // TODO(DMY-16/18): start the WebRTC signalling handshake here using the
      // discovered unit (sessionId + the resolved host/port endpoint). Until
      // then we remain honestly at "paired (signalling pending)".

      return 'paired';
    },
    [setPaired],
  );

  const reset = useCallback(() => {
    lockedRef.current = false;
    setStatus('scanning');
    setSessionId(null);
    setErrorReason(null);
    clearPairing();
  }, [clearPairing]);

  return { status, sessionId, errorReason, onScan, pairWithSessionId, reset };
}
