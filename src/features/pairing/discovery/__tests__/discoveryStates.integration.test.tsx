/**
 * Integration test (DMY-59): the discovery list's three-way state, driven by
 * the REAL useDiscoveredUnits hook wired to DiscoveredUnitsList through an
 * injected fake zeroconf backend.
 *
 * Proves the acceptance criteria end to end:
 *  - scanning, nothing resolved, grace window not elapsed -> LoadingState;
 *  - scan settled (grace elapsed) with 0 units            -> EmptyState + guidance;
 *  - a unit resolves                                       -> list, no loading/empty.
 */
import { act, render, screen } from '@testing-library/react-native';

import { generateSessionId } from '../../pairingService';
import { PAIRING_PAYLOAD_VERSION } from '../../types';
import DiscoveredUnitsList from '../DiscoveredUnitsList';
import { DEFAULT_SIGNALLING_PORT } from '../discoveryService';
import { useDiscoveredUnits } from '../useDiscovery';
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
  const backend: ZeroconfBackend = {
    scan: () => {},
    stop: () => {},
    publish: () => {},
    unpublish: () => {},
    on: (event, handler) => {
      handlers[event] = handler as never;
    },
    removeListeners: () => {},
  };
  return {
    backend,
    emitResolved: (s: ZeroconfResolvedService) => handlers.resolved?.(s),
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

/** Screen-like harness: hook -> list, mirroring ParentPairingScreen wiring. */
function DiscoverySection({ backend }: { backend: ZeroconfBackend }) {
  const { units, scanning, settled } = useDiscoveredUnits({
    backend,
    settleMs: 2500,
  });
  return (
    <DiscoveredUnitsList
      units={units}
      scanning={scanning}
      settled={settled}
      onSelect={() => {}}
    />
  );
}

describe('discovery list three-way state (integration, DMY-59)', () => {
  it('loading -> empty-with-guidance when a scan finds nothing', () => {
    jest.useFakeTimers();
    try {
      const fake = createFakeBackend();
      render(<DiscoverySection backend={fake.backend} />);

      // 1) Loading: browsing, nothing resolved, grace window not elapsed.
      expect(screen.getByTestId('discovered-loading')).toBeTruthy();
      expect(screen.queryByTestId('discovered-empty')).toBeNull();

      // 2) Grace window elapses with 0 units -> empty-with-guidance.
      act(() => {
        jest.advanceTimersByTime(2500);
      });
      expect(screen.getByTestId('discovered-empty')).toBeTruthy();
      expect(screen.getByText(/No baby units found/i)).toBeTruthy();
      expect(screen.queryByTestId('discovered-loading')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('renders the list (no loading/empty) once a unit resolves', () => {
    const fake = createFakeBackend();
    const sid = generateSessionId();
    render(<DiscoverySection backend={fake.backend} />);

    // Starts in the loading state.
    expect(screen.getByTestId('discovered-loading')).toBeTruthy();

    act(() => fake.emitResolved(resolved(sid)));

    // Populated: a tappable row, and neither loading nor empty.
    expect(screen.getByTestId(`discovered-unit-${sid}`)).toBeTruthy();
    expect(screen.queryByTestId('discovered-loading')).toBeNull();
    expect(screen.queryByTestId('discovered-empty')).toBeNull();
  });
});
