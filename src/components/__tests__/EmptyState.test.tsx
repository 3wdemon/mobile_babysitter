/**
 * Tests for EmptyState (DMY-59).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import EmptyState from '../EmptyState';

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(
      <EmptyState
        title="No baby units found"
        description="Make sure both phones are on the same Wi-Fi."
      />,
    );
    expect(screen.getByText('No baby units found')).toBeTruthy();
    expect(
      screen.getByText('Make sure both phones are on the same Wi-Fi.'),
    ).toBeTruthy();
  });

  it('announces the container as a summary labelled by the title', () => {
    render(<EmptyState title="Nothing here" />);
    const node = screen.getByTestId('empty-state');
    expect(node.props.accessibilityRole).toBe('summary');
    expect(node.props.accessibilityLabel).toBe('Nothing here');
  });

  it('does not render an action button without label + handler', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByTestId('empty-state-action')).toBeNull();
  });

  it('renders the action and fires onAction when pressed', () => {
    const onAction = jest.fn();
    render(
      <EmptyState title="Empty" actionLabel="Scan again" onAction={onAction} />,
    );
    const button = screen.getByTestId('empty-state-action');
    expect(screen.getByText('Scan again')).toBeTruthy();
    fireEvent.press(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('hides the decorative icon from screen readers', () => {
    render(<EmptyState title="Empty" icon="📡" />);
    // The icon is intentionally hidden from accessibility, so include hidden
    // elements in the query.
    const icon = screen.getByTestId('empty-state-icon', {
      includeHiddenElements: true,
    });
    expect(icon).toHaveTextContent('📡');
    expect(icon.props.accessibilityElementsHidden).toBe(true);
  });

  it('honours a custom testID', () => {
    render(<EmptyState testID="discovered-empty" title="Empty" />);
    expect(screen.getByTestId('discovered-empty')).toBeTruthy();
  });
});
