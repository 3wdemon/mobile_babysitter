/**
 * usePairingSession — baby-unit pairing-session state (DMY-6).
 *
 * Owns the current {@link PairingPayload} and its serialized QR string, plus a
 * `regenerate` action that mints a brand-new session id (invalidating any
 * previously displayed QR / screenshot). A new payload is created lazily on
 * first render so each baby-unit visit gets a fresh, single-use session.
 *
 * No network and no persistence: the session is ephemeral runtime state and is
 * intentionally NOT written to disk (privacy — a session id should not outlive
 * the pairing attempt).
 */
import { useCallback, useMemo, useState } from 'react';

import { logger } from '../../services/logger';
import {
  createPairingPayload,
  serializePairingPayload,
} from './pairingService';
import type { PairingConnectionInfo, PairingPayload } from './types';

/** Value returned by {@link usePairingSession}. */
export interface PairingSession {
  /** The current pairing payload (structured). */
  readonly payload: PairingPayload;
  /** The payload serialized to the string encoded into the QR. */
  readonly qrValue: string;
  /** Mint a new session id, replacing the current payload. */
  readonly regenerate: () => void;
}

/**
 * @param connection Optional connection info to embed (WebRTC; omitted in DMY-6).
 */
export function usePairingSession(
  connection?: PairingConnectionInfo,
): PairingSession {
  const [payload, setPayload] = useState<PairingPayload>(() => {
    const initial = createPairingPayload(connection);
    // Log only the non-sensitive session id (the redactor would mask sdp/ice
    // anyway); never log the serialized QR value.
    logger.info('pairing: session created', { sessionId: initial.sessionId });
    return initial;
  });

  const regenerate = useCallback(() => {
    const next = createPairingPayload(connection);
    logger.info('pairing: session regenerated', { sessionId: next.sessionId });
    setPayload(next);
  }, [connection]);

  const qrValue = useMemo(
    () => serializePairingPayload(payload),
    [payload],
  );

  return { payload, qrValue, regenerate };
}
