/**
 * Component tests for DiscoveredUnitsList (DMY-7).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { generateSessionId } from '../../pairingService';
import { PAIRING_PAYLOAD_VERSION } from '../../types';
import DiscoveredUnitsList from '../DiscoveredUnitsList';
import { DEFAULT_SIGNALLING_PORT } from '../discoveryService';
import type { DiscoveredBabyUnit } from '../types';

function unit(sid: string): DiscoveredBabyUnit {
  return {
    name: `mbs-${sid.slice(0, 8)}`,
    host: '192.168.1.7',
    port: DEFAULT_SIGNALLING_PORT,
    sessionId: sid,
    version: PAIRING_PAYLOAD_VERSION,
  };
}

describe('DiscoveredUnitsList', () => {
  it('shows the looking-for-units empty state while scanning', () => {
    render(<DiscoveredUnitsList units={[]} scanning onSelect={jest.fn()} />);
    expect(screen.getByText(/Looking for baby units/i)).toBeTruthy();
  });

  it('shows the discovery-off empty state when not scanning', () => {
    render(
      <DiscoveredUnitsList units={[]} scanning={false} onSelect={jest.fn()} />,
    );
    expect(screen.getByText(/discovery is off/i)).toBeTruthy();
  });

  it('renders a row per unit and fires onSelect with its sessionId', () => {
    const sid = generateSessionId();
    const onSelect = jest.fn();
    render(
      <DiscoveredUnitsList units={[unit(sid)]} scanning onSelect={onSelect} />,
    );

    const row = screen.getByTestId(`discovered-unit-${sid}`);
    expect(row).toBeTruthy();
    fireEvent.press(row);
    expect(onSelect).toHaveBeenCalledWith(sid);
  });

  it('does not display the raw session id in row text (privacy)', () => {
    const sid = generateSessionId();
    render(
      <DiscoveredUnitsList units={[unit(sid)]} scanning onSelect={jest.fn()} />,
    );
    // The visible row title is the Bonjour instance name (short slice), not the
    // full session id; the full id is never rendered as text.
    expect(screen.queryByText(sid)).toBeNull();
  });
});
