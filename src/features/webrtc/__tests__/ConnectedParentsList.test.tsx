/**
 * Unit tests for ConnectedParentsList (DMY-66) — the baby-unit viewer list.
 *
 * Verifies the count copy, per-viewer rows + status (driven by the real
 * `parents` prop, never fabricated), the empty state, and the localised
 * "viewer limit reached" notice (AC #3). All copy comes from the i18n catalog.
 */
import { render, screen } from '@testing-library/react-native';

import ConnectedParentsList from '../ConnectedParentsList';
import { t } from '../../../services/i18n';
import type { BroadcastParent } from '../babyBroadcast';

const p = (
  clientId: string,
  status: BroadcastParent['status'],
): BroadcastParent => ({ clientId, status });

describe('ConnectedParentsList', () => {
  it('shows the empty state with zero viewers', () => {
    render(
      <ConnectedParentsList parents={[]} maxParents={3} capReached={false} />,
    );
    expect(screen.getByTestId('connected-parents-empty')).toBeTruthy();
    expect(screen.getByTestId('connected-parents-count')).toHaveTextContent(
      t('webrtc.broadcast.count', { count: 0, max: 3 }),
    );
  });

  it('renders one row per parent with its coarse status (never fabricated)', () => {
    render(
      <ConnectedParentsList
        parents={[p('a', 'connected'), p('b', 'connecting')]}
        maxParents={3}
        capReached={false}
      />,
    );
    expect(screen.getByTestId('connected-parent-a')).toBeTruthy();
    expect(screen.getByTestId('connected-parent-b')).toBeTruthy();
    // Count reflects only the CONNECTED parents.
    expect(screen.getByTestId('connected-parents-count')).toHaveTextContent(
      t('webrtc.broadcast.count', { count: 1, max: 3 }),
    );
    expect(screen.queryByTestId('connected-parents-empty')).toBeNull();
  });

  it('shows the localised "viewer limit reached" notice only when capReached', () => {
    const { rerender } = render(
      <ConnectedParentsList
        parents={[
          p('a', 'connected'),
          p('b', 'connected'),
          p('c', 'connected'),
        ]}
        maxParents={3}
        capReached={false}
      />,
    );
    expect(screen.queryByTestId('connected-parents-full')).toBeNull();

    rerender(
      <ConnectedParentsList
        parents={[
          p('a', 'connected'),
          p('b', 'connected'),
          p('c', 'connected'),
        ]}
        maxParents={3}
        capReached
      />,
    );
    const full = screen.getByTestId('connected-parents-full');
    expect(full).toHaveTextContent(t('webrtc.broadcast.full', { max: 3 }));
  });
});
