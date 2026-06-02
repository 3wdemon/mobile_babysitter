/**
 * Unit tests for MotionIndicator (DMY-25).
 *
 * Pure presentational checks: label reflects the moving state, fill width tracks
 * the metric (clamped), and non-finite metrics do not crash.
 */
import { render, screen } from '@testing-library/react-native';

import MotionIndicator from '../MotionIndicator';

describe('MotionIndicator', () => {
  it('shows the still label when not moving', () => {
    render(<MotionIndicator metric={0.02} threshold={0.15} moving={false} />);
    expect(screen.getByText('Still')).toBeTruthy();
  });

  it('shows the motion-detected label when moving', () => {
    render(<MotionIndicator metric={0.5} threshold={0.15} moving={true} />);
    expect(screen.getByText('Motion detected')).toBeTruthy();
  });

  it('renders the fill width proportional to the metric', () => {
    render(<MotionIndicator metric={0.5} threshold={0.15} moving={false} />);
    const fill = screen.getByTestId('motion-indicator-fill');
    expect(fill.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '50%' })]),
    );
  });

  it('clamps an out-of-range metric to the bar width', () => {
    render(<MotionIndicator metric={5} threshold={0.15} moving={true} />);
    const fill = screen.getByTestId('motion-indicator-fill');
    expect(fill.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '100%' })]),
    );
  });

  it('renders a zero-width fill for a null metric without crashing', () => {
    render(<MotionIndicator metric={null} threshold={0.15} moving={false} />);
    const fill = screen.getByTestId('motion-indicator-fill');
    expect(fill.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '0%' })]),
    );
  });

  it('does not crash on a NaN metric', () => {
    expect(() =>
      render(<MotionIndicator metric={NaN} threshold={0.15} moving={false} />),
    ).not.toThrow();
  });
});
