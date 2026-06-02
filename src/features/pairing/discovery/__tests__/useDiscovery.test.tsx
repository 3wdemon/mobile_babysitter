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
    renderHook(() =>
      useDiscoveredUnits({ backend: fake.backend, enabled: false }),
    );
    expect(fake.calls.scan).toBe(0);
  });

  it('settles immediately when a unit resolves (DMY-59)', () => {
    const fake = createFakeBackend();
    const sid = generateSessionId();
    const { result } = renderHook(() =>
      useDiscoveredUnits({ backend: fake.backend, settleMs: 10_000 }),
    );

    // Browsing, nothing resolved, grace window not elapsed -> not settled.
    expect(result.current.settled).toBe(false);

    act(() => fake.emitResolved(resolved(sid)));
    expect(result.current.settled).toBe(true);
  });

  it('settles after the grace window with 0 units (DMY-59)', () => {
    jest.useFakeTimers();
    try {
      const fake = createFakeBackend();
      const { result } = renderHook(() =>
        useDiscoveredUnits({ backend: fake.backend, settleMs: 2500 }),
      );

      expect(result.current.settled).toBe(false);

      act(() => {
        jest.advanceTimersByTime(2500);
      });

      expect(result.current.settled).toBe(true);
      expect(result.current.units).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('is never settled while disabled (DMY-59)', () => {
    jest.useFakeTimers();
    try {
      const fake = createFakeBackend();
      const { result } = renderHook(() =>
        useDiscoveredUnits({
          backend: fake.backend,
          enabled: false,
          settleMs: 1,
        }),
      );
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(result.current.settled).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears the grace timer on unmount mid-window (no leak / act warning) (DMY-59)', () => {
    jest.useFakeTimers();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fake = createFakeBackend();
      const { result, unmount } = renderHook(() =>
        useDiscoveredUnits({ backend: fake.backend, settleMs: 2500 }),
      );
      // Browse running, grace window open, nothing resolved yet.
      expect(result.current.settled).toBe(false);

      // Unmount BEFORE the grace timer fires, then advance past it. The cleanup
      // must clear the pending setTimeout so setGraceElapsed never fires on the
      // unmounted hook — otherwise React logs an act(...)/state-on-unmounted
      // warning to console.error.
      unmount();
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(fake.calls.stop).toBe(1);
      expect(fake.calls.removeListeners).toBe(1);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('re-arms the grace window when re-enabled after settling (DMY-59)', () => {
    jest.useFakeTimers();
    try {
      const fake = createFakeBackend();
      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useDiscoveredUnits({ backend: fake.backend, enabled, settleMs: 2500 }),
        { initialProps: { enabled: true } },
      );

      // Settle the first browse with 0 units.
      act(() => {
        jest.advanceTimersByTime(2500);
      });
      expect(result.current.settled).toBe(true);

      // Disable: no browse to settle.
      act(() => rerender({ enabled: false }));
      expect(result.current.settled).toBe(false);

      // Re-enable: a fresh browse begins and the grace window must restart, so
      // an empty result reads as "loading" again, not a stale "settled".
      act(() => rerender({ enabled: true }));
      expect(result.current.settled).toBe(false);

      act(() => {
        jest.advanceTimersByTime(2500);
      });
      expect(result.current.settled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
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
