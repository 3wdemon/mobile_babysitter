/**
 * Unit tests for the mDNS/Bonjour discovery service core (DMY-7).
 *
 * No native code: a hand-rolled fake {@link ZeroconfBackend} drives the
 * `resolved`/`removed`/`error` events synchronously so we can assert the
 * resolved-units list, TXT (de)serialisation, validation, idempotency, the
 * no-op fallback and the privacy contract (TXT contents + logging).
 */
import { logger } from '../../../../services/logger';
import { generateSessionId } from '../../pairingService';
import { PAIRING_PAYLOAD_VERSION } from '../../types';
import {
  buildPublishConfig,
  createDiscoveryService,
  DEFAULT_SIGNALLING_PORT,
  noopZeroconfBackend,
  parseResolvedService,
} from '../discoveryService';
import {
  TXT_KEY_SESSION_ID,
  TXT_KEY_VERSION,
  type PublishServiceConfig,
  type ZeroconfBackend,
  type ZeroconfBackendEvents,
  type ZeroconfResolvedService,
} from '../types';

/** A controllable fake backend recording calls and exposing event emitters. */
function createFakeBackend(options?: { throwOnScan?: boolean }) {
  const handlers: Partial<{
    [K in keyof ZeroconfBackendEvents]: ZeroconfBackendEvents[K];
  }> = {};
  const calls = {
    scan: 0,
    stop: 0,
    publish: [] as PublishServiceConfig[],
    unpublish: [] as string[],
    removeListeners: 0,
  };

  const backend: ZeroconfBackend = {
    scan: () => {
      if (options?.throwOnScan) {
        throw new Error('native scan blew up');
      }
      calls.scan += 1;
    },
    stop: () => {
      calls.stop += 1;
    },
    publish: config => {
      calls.publish.push(config);
    },
    unpublish: name => {
      calls.unpublish.push(name);
    },
    on: (event, handler) => {
      handlers[event] = handler as never;
    },
    removeListeners: () => {
      calls.removeListeners += 1;
    },
  };

  return {
    backend,
    calls,
    emitResolved: (s: ZeroconfResolvedService) => handlers.resolved?.(s),
    emitRemoved: (name: string) => handlers.removed?.(name),
    emitError: (e: unknown) => handlers.error?.(e),
  };
}

function resolvedService(
  sessionId: string,
  overrides: Partial<ZeroconfResolvedService> = {},
): ZeroconfResolvedService {
  return {
    name: `mbs-${sessionId.slice(0, 8)}`,
    host: '192.168.1.42',
    port: DEFAULT_SIGNALLING_PORT,
    txt: {
      [TXT_KEY_SESSION_ID]: sessionId,
      [TXT_KEY_VERSION]: String(PAIRING_PAYLOAD_VERSION),
    },
    ...overrides,
  };
}

describe('buildPublishConfig', () => {
  it('builds a TXT record with only sessionId + version (no PII/secrets)', () => {
    const sid = generateSessionId();
    const config = buildPublishConfig(sid);

    expect(config.port).toBe(DEFAULT_SIGNALLING_PORT);
    expect(config.name).toBe(`mbs-${sid.slice(0, 8)}`);
    // TXT carries EXACTLY sid + v, nothing else.
    expect(Object.keys(config.txt).sort()).toEqual(
      [TXT_KEY_SESSION_ID, TXT_KEY_VERSION].sort(),
    );
    expect(config.txt[TXT_KEY_SESSION_ID]).toBe(sid);
    expect(config.txt[TXT_KEY_VERSION]).toBe(String(PAIRING_PAYLOAD_VERSION));
  });
});

describe('parseResolvedService', () => {
  it('parses a well-formed advertisement into a DiscoveredBabyUnit', () => {
    const sid = generateSessionId();
    const unit = parseResolvedService(resolvedService(sid));
    expect(unit).toEqual({
      name: `mbs-${sid.slice(0, 8)}`,
      host: '192.168.1.42',
      port: DEFAULT_SIGNALLING_PORT,
      sessionId: sid,
      version: PAIRING_PAYLOAD_VERSION,
    });
  });

  it('drops a service with no/invalid session id in TXT', () => {
    expect(
      parseResolvedService(resolvedService('not-a-uuid')),
    ).toBeNull();
    expect(
      parseResolvedService({
        name: 'mbs-x',
        host: '10.0.0.1',
        port: 8443,
        txt: {},
      }),
    ).toBeNull();
  });

  it('drops a service that is found but not yet resolved (no host/port)', () => {
    const sid = generateSessionId();
    expect(
      parseResolvedService(resolvedService(sid, { host: undefined })),
    ).toBeNull();
    expect(
      parseResolvedService(resolvedService(sid, { port: undefined })),
    ).toBeNull();
  });

  it('tolerates an unknown/absent version (keeps the unit, version undefined)', () => {
    const sid = generateSessionId();
    const unit = parseResolvedService(
      resolvedService(sid, {
        txt: { [TXT_KEY_SESSION_ID]: sid, [TXT_KEY_VERSION]: '999' },
      }),
    );
    expect(unit?.sessionId).toBe(sid);
    expect(unit?.version).toBeUndefined();
  });
});

describe('DiscoveryService — scanning (parent)', () => {
  it('starts a browse and adds a unit on a resolved event', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    const sid = generateSessionId();

    service.startScanning();
    expect(fake.calls.scan).toBe(1);
    expect(service.isScanning).toBe(true);
    expect(service.getUnits()).toEqual([]);

    fake.emitResolved(resolvedService(sid));
    const units = service.getUnits();
    expect(units).toHaveLength(1);
    expect(units[0].sessionId).toBe(sid);
  });

  it('removes a unit on a removed event', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    const sid = generateSessionId();
    const name = `mbs-${sid.slice(0, 8)}`;

    service.startScanning();
    fake.emitResolved(resolvedService(sid));
    expect(service.getUnits()).toHaveLength(1);

    fake.emitRemoved(name);
    expect(service.getUnits()).toEqual([]);
  });

  it('dedups: re-resolving the same instance updates in place (no duplicate)', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    const sid = generateSessionId();

    service.startScanning();
    fake.emitResolved(resolvedService(sid, { host: '192.168.1.10' }));
    fake.emitResolved(resolvedService(sid, { host: '192.168.1.20' }));

    const units = service.getUnits();
    // Same Bonjour instance name -> single entry, latest host wins.
    expect(units).toHaveLength(1);
    expect(units[0].sessionId).toBe(sid);
    expect(units[0].host).toBe('192.168.1.20');
  });

  it('ignores a resolved event for a foreign/corrupt service', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    service.startScanning();

    fake.emitResolved(resolvedService('not-a-uuid'));
    expect(service.getUnits()).toEqual([]);
  });

  it('is idempotent: a second startScanning does not re-scan', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    service.startScanning();
    service.startScanning();
    expect(fake.calls.scan).toBe(1);
  });

  it('stopScanning stops the browse and clears the list', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    service.startScanning();
    fake.emitResolved(resolvedService(generateSessionId()));
    expect(service.getUnits()).toHaveLength(1);

    service.stopScanning();
    expect(fake.calls.stop).toBe(1);
    expect(service.isScanning).toBe(false);
    expect(service.getUnits()).toEqual([]);
    // Idempotent: a second stop is a no-op.
    service.stopScanning();
    expect(fake.calls.stop).toBe(1);
  });

  it('notifies subscribers on change and on unsubscribe stops notifying', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    const seen: number[] = [];
    const unsubscribe = service.subscribe(units => seen.push(units.length));

    // subscribe() fires immediately with the empty snapshot.
    expect(seen).toEqual([0]);

    service.startScanning();
    fake.emitResolved(resolvedService(generateSessionId()));
    expect(seen[seen.length - 1]).toBe(1);

    unsubscribe();
    fake.emitResolved(resolvedService(generateSessionId()));
    // No further notifications after unsubscribe.
    expect(seen[seen.length - 1]).toBe(1);
  });
});

describe('DiscoveryService — publishing (baby)', () => {
  it('publishes a service with the correct type/TXT and no PII', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    const sid = generateSessionId();

    service.startPublishing(sid);
    expect(service.isPublishing).toBe(true);
    expect(fake.calls.publish).toHaveLength(1);
    const config = fake.calls.publish[0];
    expect(config.txt[TXT_KEY_SESSION_ID]).toBe(sid);
    expect(config.txt[TXT_KEY_VERSION]).toBe(String(PAIRING_PAYLOAD_VERSION));
    // No personal/secret fields leak into the advertisement.
    expect(Object.keys(config.txt).sort()).toEqual(
      [TXT_KEY_SESSION_ID, TXT_KEY_VERSION].sort(),
    );
  });

  it('is idempotent for the same session id', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    const sid = generateSessionId();
    service.startPublishing(sid);
    service.startPublishing(sid);
    expect(fake.calls.publish).toHaveLength(1);
  });

  it('withdraws the previous advertisement when the session id changes', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    const sid1 = generateSessionId();
    const sid2 = generateSessionId();
    service.startPublishing(sid1);
    service.startPublishing(sid2);
    expect(fake.calls.unpublish).toEqual([`mbs-${sid1.slice(0, 8)}`]);
    expect(fake.calls.publish).toHaveLength(2);
  });

  it('refuses to publish a malformed session id', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    service.startPublishing('not-a-uuid');
    expect(fake.calls.publish).toHaveLength(0);
    expect(service.isPublishing).toBe(false);
  });

  it('stopPublishing withdraws the service and is idempotent', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    const sid = generateSessionId();
    service.startPublishing(sid);
    service.stopPublishing();
    expect(fake.calls.unpublish).toEqual([`mbs-${sid.slice(0, 8)}`]);
    service.stopPublishing();
    expect(fake.calls.unpublish).toHaveLength(1);
  });
});

describe('DiscoveryService — teardown & resilience', () => {
  it('dispose stops scan, unpublishes and removes backend listeners', () => {
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    service.startScanning();
    service.startPublishing(generateSessionId());

    service.dispose();
    expect(fake.calls.stop).toBe(1);
    expect(fake.calls.unpublish).toHaveLength(1);
    expect(fake.calls.removeListeners).toBe(1);
    expect(service.isScanning).toBe(false);
    expect(service.isPublishing).toBe(false);
  });

  it('does not throw when the backend throws', () => {
    const fake = createFakeBackend({ throwOnScan: true });
    const service = createDiscoveryService(fake.backend);
    expect(() => service.startScanning()).not.toThrow();
    // Still marked scanning (the JS state advanced; the native call failed safe).
    expect(service.isScanning).toBe(true);
  });

  it('falls back to the no-op backend without throwing', () => {
    const service = createDiscoveryService(noopZeroconfBackend);
    expect(() => {
      service.startScanning();
      service.startPublishing(generateSessionId());
      service.stopPublishing();
      service.stopScanning();
      service.dispose();
    }).not.toThrow();
    expect(service.getUnits()).toEqual([]);
  });

  it('logs only a coarse fact on a backend error (no crash)', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    service.startScanning();
    expect(() => fake.emitError(new Error('boom'))).not.toThrow();
    expect(warn).toHaveBeenCalledWith('discovery: backend reported an error');
    warn.mockRestore();
  });
});

describe('DiscoveryService — privacy', () => {
  // The session id is NOT a cryptographic secret (it is also shown in the QR),
  // but to match the rest of the pairing layer (usePairingSession /
  // usePairingScanner) it must only ever be passed to the logger under a
  // dedicated `sessionId` key — never inlined into a message string and never
  // logged alongside the resolved host/port. This keeps log lines uniform and
  // lets a stricter redactor mask one well-known key if policy tightens.
  it('only ever passes the session id under a dedicated sessionId key', () => {
    const sid = generateSessionId();
    const lines: Array<{ message: unknown; extra: unknown }> = [];
    const capture = (...args: unknown[]) => {
      lines.push({ message: args[0], extra: args[1] });
    };
    const spies = (['info', 'warn', 'debug', 'error'] as const).map(level =>
      jest.spyOn(logger, level).mockImplementation(capture),
    );

    const fake = createFakeBackend();
    const service = createDiscoveryService(fake.backend);
    service.startPublishing(sid);
    service.startScanning();
    fake.emitResolved(resolvedService(sid));

    for (const { message, extra } of lines) {
      // The id never appears inlined in the human-readable message.
      expect(String(message)).not.toContain(sid);
      // When carried, it is ONLY under the `sessionId` key — no host/port/txt.
      if (extra && typeof extra === 'object') {
        const keys = Object.keys(extra as Record<string, unknown>);
        for (const key of keys) {
          const value = (extra as Record<string, unknown>)[key];
          if (value === sid) {
            expect(key).toBe('sessionId');
          }
        }
        expect(keys).not.toContain('host');
        expect(keys).not.toContain('port');
        expect(keys).not.toContain('txt');
      }
    }

    spies.forEach(s => s.mockRestore());
  });
});
