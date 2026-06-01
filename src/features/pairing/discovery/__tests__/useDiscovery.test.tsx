/**
 * Hook tests for useDiscovery (DMY-7).
 *
 * Inject a fake ZeroconfBackend and assert that:
 *  - the parent hook starts a browse on mount, surfaces resolved/removed units,
 *    and stops the browse on unmount (no leak);
 *  - the baby hook publishes on mount, re-publishes on session-id change, and
 *    unpublishes on unmount.
 */
import { act, renderHook } from '@testing-library/react-native';

import { generateSessionId } from '../../pairingService';
import { PAIRING_PAYLOAD_VERSION } from '../../types';
import { DEFAULT_SIGNALLING_PORT } from '../discoveryService';
import { useDiscoveredUnits, usePublishService } from '../useDiscovery';
import {
  TXT_KEY_SESSION_ID,
  TXT_KEY_VERSION,
  type ZeroconfBackend,
  type ZeroconfBackendEvents,
  type ZeroconfResolvedService,
} from '../types';

function createFakeBackend() {
  const handlers: Partial<{
    [K in keyof ZeroconfBackendEvents]: ZeroconfBackendEvents[K];
  }> = {};
  const calls = {
    scan: 0,
    stop: 0,
    publish: [] as string[],
    unpublish: [] as string[],
    removeListeners: 0,
  };
  const backend: ZeroconfBackend = {
    scan: () => {
      calls.scan += 1;
    },
    stop: () => {
      calls.stop += 1;
    },
    publish: config => {
      calls.publish.push(config.name);
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
  };
}

function resolved(sid: string): ZeroconfResolvedService {
  return {
    name: `mbs-${sid.slice(0, 8)}`,
    host: '192.168.0.5',
    port: DEFAULT_SIGNALLING_PORT,
    txt: {
      [TXT_KEY_SESSION_ID]: sid,
      [TXT_KEY_VERSION]: String(PAIRING_PAYLOAD_VERSION),
    },
  };
}

describe('useDiscoveredUnits (parent)', () => {
  it('starts a browse on mount and exposes resolved units', () => {
    const fake = createFakeBackend();
    const sid = generateSessionId();
    const { result } = renderHook(() =>
      useDiscoveredUnits({ backend: fake.backend }),
    );

    expect(fake.calls.scan).toBe(1);
    expect(result.current.scanning).toBe(true);
    expect(result.current.units).toEqual([]);

    act(() => fake.emitResolved(resolved(sid)));
    expect(result.current.units).toHaveLength(1);
    expect(result.current.units[0].sessionId).toBe(sid);

    act(() => fake.emitRemoved(`mbs-${sid.slice(0, 8)}`));
    expect(result.current.units).toEqual([]);
  });

  it('stops the browse and removes listeners on unmount (no leak)', () => {
    const fake = createFakeBackend();
    const { unmount } = renderHook(() =>
      useDiscoveredUnits({ backend: fake.backend }),
    );
    expect(fake.calls.scan).toBe(1);

    unmount();
    expect(fake.calls.stop).toBe(1);
    expect(fake.calls.removeListeners).toBe(1);
  });

  it('does not browse when disabled', () => {
    const fake = createFakeBackend();
    renderHook(() => useDiscoveredUnits({ backend: fake.backend, enabled: false }));
    expect(fake.calls.scan).toBe(0);
  });
});

describe('usePublishService (baby)', () => {
  it('publishes on mount and unpublishes on unmount', () => {
    const fake = createFakeBackend();
    const sid = generateSessionId();
    const { result, unmount } = renderHook(() =>
      usePublishService({ sessionId: sid, backend: fake.backend }),
    );

    expect(fake.calls.publish).toEqual([`mbs-${sid.slice(0, 8)}`]);
    expect(result.current.publishing).toBe(true);

    unmount();
    expect(fake.calls.unpublish).toEqual([`mbs-${sid.slice(0, 8)}`]);
  });

  it('re-publishes when the session id changes (e.g. "New code")', () => {
    const fake = createFakeBackend();
    const sid1 = generateSessionId();
    const sid2 = generateSessionId();
    const { rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        usePublishService({ sessionId, backend: fake.backend }),
      { initialProps: { sessionId: sid1 } },
    );
    expect(fake.calls.publish).toEqual([`mbs-${sid1.slice(0, 8)}`]);

    act(() => rerender({ sessionId: sid2 }));
    expect(fake.calls.unpublish).toContain(`mbs-${sid1.slice(0, 8)}`);
    expect(fake.calls.publish).toEqual([
      `mbs-${sid1.slice(0, 8)}`,
      `mbs-${sid2.slice(0, 8)}`,
    ]);
  });

  it('does not publish when disabled', () => {
    const fake = createFakeBackend();
    const { result } = renderHook(() =>
      usePublishService({
        sessionId: generateSessionId(),
        backend: fake.backend,
        enabled: false,
      }),
    );
    expect(fake.calls.publish).toHaveLength(0);
    expect(result.current.publishing).toBe(false);
  });
});
