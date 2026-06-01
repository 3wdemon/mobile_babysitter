/**
 * Unit tests for the pairing service (DMY-6).
 *
 * Cover: crypto-strong session-id generation (format, uniqueness, version/
 * variant bits, fail-closed when no CSPRNG), payload construction, and the
 * serialize/parse round-trip + rejection of foreign/corrupt QRs. A privacy
 * assertion guarantees the payload carries nothing sensitive beyond what is
 * needed to connect.
 */
import {
  createPairingPayload,
  generateSessionId,
  isValidSessionId,
  parsePairingPayload,
  serializePairingPayload,
} from '../pairingService';
import { PAIRING_PAYLOAD_VERSION, PAIRING_TYPE } from '../types';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateSessionId', () => {
  it('produces a well-formed UUID v4', () => {
    const id = generateSessionId();
    expect(id).toMatch(UUID_V4_RE);
    expect(isValidSessionId(id)).toBe(true);
  });

  it('produces unique ids across many calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateSessionId());
    }
    expect(ids.size).toBe(1000);
  });

  it('draws from a cryptographically-strong RNG (crypto.getRandomValues)', () => {
    const cryptoObj = (
      globalThis as unknown as {
        crypto: { getRandomValues: (a: Uint8Array) => Uint8Array };
      }
    ).crypto;
    const spy = jest.spyOn(cryptoObj, 'getRandomValues');
    generateSessionId();
    expect(spy).toHaveBeenCalledTimes(1);
    // 16 bytes requested for a 122-bit UUID v4.
    expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(16);
    spy.mockRestore();
  });

  it('fails closed when no CSPRNG is available (never falls back to Math.random)', () => {
    const g = globalThis as unknown as { crypto?: unknown };
    const original = g.crypto;
    // Deliberately remove crypto to exercise the fail-closed path.
    delete g.crypto;
    try {
      expect(() => generateSessionId()).toThrow(/cryptographically-strong RNG/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: original,
        configurable: true,
      });
    }
  });
});

describe('isValidSessionId', () => {
  it('rejects non-UUID and non-string values', () => {
    expect(isValidSessionId('not-a-uuid')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId(123)).toBe(false);
    expect(isValidSessionId(null)).toBe(false);
    expect(isValidSessionId(undefined)).toBe(false);
    // Wrong version nibble (3 instead of 4).
    expect(isValidSessionId('00000000-0000-3000-8000-000000000000')).toBe(false);
  });
});

describe('createPairingPayload', () => {
  it('builds a versioned payload with a valid session id and injected clock', () => {
    const payload = createPairingPayload(undefined, 1_700_000_000_000);
    expect(payload.type).toBe(PAIRING_TYPE);
    expect(payload.version).toBe(PAIRING_PAYLOAD_VERSION);
    expect(isValidSessionId(payload.sessionId)).toBe(true);
    expect(payload.createdAt).toBe(1_700_000_000_000);
    // No WebRTC yet -> no connection block.
    expect(payload.connection).toBeUndefined();
  });

  it('embeds connection info when provided (WebRTC placeholder)', () => {
    const payload = createPairingPayload(
      { sdp: 'v=0...', iceCandidates: ['candidate:1 ...'] },
      0,
    );
    expect(payload.connection?.sdp).toBe('v=0...');
    expect(payload.connection?.iceCandidates).toEqual(['candidate:1 ...']);
  });
});

describe('serialize / parse round-trip', () => {
  it('round-trips a minimal payload', () => {
    const payload = createPairingPayload(undefined, 1_700_000_000_000);
    const parsed = parsePairingPayload(serializePairingPayload(payload));
    expect(parsed).toEqual(payload);
  });

  it('round-trips a payload with connection info', () => {
    const payload = createPairingPayload(
      {
        sdp: 'v=0 offer',
        iceCandidates: ['candidate:a', 'candidate:b'],
        discovery: { serviceName: '_mbs._tcp.local', port: 5353 },
      },
      42,
    );
    const parsed = parsePairingPayload(serializePairingPayload(payload));
    expect(parsed).toEqual(payload);
  });

  it('emits compact JSON (no whitespace)', () => {
    const str = serializePairingPayload(createPairingPayload(undefined, 0));
    expect(str).not.toMatch(/\n/);
    expect(str.startsWith('{')).toBe(true);
  });
});

describe('parsePairingPayload rejection', () => {
  it('returns null for malformed JSON', () => {
    expect(parsePairingPayload('{not json')).toBeNull();
    expect(parsePairingPayload('')).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    expect(parsePairingPayload('42')).toBeNull();
    expect(parsePairingPayload('"hello"')).toBeNull();
    expect(parsePairingPayload('null')).toBeNull();
    expect(parsePairingPayload('[]')).toBeNull();
  });

  it('returns null for a foreign QR (wrong type)', () => {
    expect(
      parsePairingPayload(
        JSON.stringify({ type: 'something-else', version: 1 }),
      ),
    ).toBeNull();
  });

  it('returns null for an unknown version', () => {
    expect(
      parsePairingPayload(
        JSON.stringify({
          type: PAIRING_TYPE,
          version: 999,
          sessionId: generateSessionId(),
          createdAt: 0,
        }),
      ),
    ).toBeNull();
  });

  it('returns null for an invalid session id', () => {
    expect(
      parsePairingPayload(
        JSON.stringify({
          type: PAIRING_TYPE,
          version: PAIRING_PAYLOAD_VERSION,
          sessionId: 'nope',
          createdAt: 0,
        }),
      ),
    ).toBeNull();
  });

  it('returns null for a missing/invalid createdAt', () => {
    expect(
      parsePairingPayload(
        JSON.stringify({
          type: PAIRING_TYPE,
          version: PAIRING_PAYLOAD_VERSION,
          sessionId: generateSessionId(),
          createdAt: 'soon',
        }),
      ),
    ).toBeNull();
  });
});

describe('privacy', () => {
  it('payload contains ONLY the fields needed to connect — no PII/secrets', () => {
    const payload = createPairingPayload(undefined, 0);
    // Whole-key allowlist: nothing beyond the connection envelope is present.
    expect(Object.keys(payload).sort()).toEqual(
      ['createdAt', 'sessionId', 'type', 'version'].sort(),
    );
    // Defensive: the serialized blob must not contain obvious sensitive tokens.
    const serialized = serializePairingPayload(payload).toLowerCase();
    for (const banned of [
      'password',
      'email',
      'token',
      'biometric',
      'account',
      'apikey',
    ]) {
      expect(serialized).not.toContain(banned);
    }
  });
});
