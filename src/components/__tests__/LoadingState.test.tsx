/**
 * Tests for LoadingState (DMY-59).
 */
import { render, screen } from '@testing-library/react-native';

import LoadingState from '../LoadingState';

describe('LoadingState', () => {
  it('renders a spinner with the default testID', () => {
    render(<LoadingState />);
    expect(screen.getByTestId('loading-state')).toBeTruthy();
    expect(screen.getByTestId('loading-state-spinner')).toBeTruthy();
  });

  it('shows the message when provided', () => {
    render(<LoadingState message="Looking for baby units…" />);
    expect(screen.getByText('Looking for baby units…')).toBeTruthy();
  });

  it('announces a busy progressbar with the message as its label', () => {
    render(<LoadingState message="Connecting…" />);
    const node = screen.getByTestId('loading-state');
    expect(node.props.accessibilityRole).toBe('progressbar');
    expect(node.props.accessibilityLabel).toBe('Connecting…');
  });

  it('falls back to a generic label when there is no message', () => {
    render(<LoadingState />);
    expect(screen.getByTestId('loading-state').props.accessibilityLabel).toBe(
      'Loading',
    );
  });

  it('prefers an explicit accessibilityLabel over the message', () => {
    render(
      <LoadingState
        message="Looking…"
        accessibilityLabel="Searching network"
      />,
    );
    expect(screen.getByTestId('loading-state').props.accessibilityLabel).toBe(
      'Searching network',
    );
  });

  it('honours a custom testID', () => {
    render(<LoadingState testID="parent-connecting" />);
    expect(screen.getByTestId('parent-connecting')).toBeTruthy();
    expect(screen.getByTestId('parent-connecting-spinner')).toBeTruthy();
  });
});
