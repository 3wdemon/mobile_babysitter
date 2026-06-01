/**
 * Unit tests for NoiseLevelIndicator (DMY-8).
 *
 * Pure presentational checks: label reflects the armed state, fill width tracks
 * the level (clamped), and non-finite levels do not crash.
 */
import { render, screen } from '@testing-library/react-native';

import NoiseLevelIndicator from '../NoiseLevelIndicator';

describe('NoiseLevelIndicator', () => {
  it('shows the listening label when not armed', () => {
    render(<NoiseLevelIndicator level={0.2} threshold={0.6} armed={false} />);
    expect(screen.getByText('Listening')).toBeTruthy();
  });

  it('shows the noise-detected label when armed', () => {
    render(<NoiseLevelIndicator level={0.9} threshold={0.6} armed={true} />);
    expect(screen.getByText('Noise detected')).toBeTruthy();
  });

  it('renders the fill width proportional to the level', () => {
    render(<NoiseLevelIndicator level={0.5} threshold={0.6} armed={false} />);
    const fill = screen.getByTestId('noise-indicator-fill');
    expect(fill.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '50%' })]),
    );
  });

  it('clamps an out-of-range level to the bar width', () => {
    render(<NoiseLevelIndicator level={5} threshold={0.6} armed={true} />);
    const fill = screen.getByTestId('noise-indicator-fill');
    expect(fill.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '100%' })]),
    );
  });

  it('renders a zero-width fill for a null level without crashing', () => {
    render(<NoiseLevelIndicator level={null} threshold={0.6} armed={false} />);
    const fill = screen.getByTestId('noise-indicator-fill');
    expect(fill.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '0%' })]),
    );
  });

  it('does not crash on a NaN level', () => {
    expect(() =>
      render(<NoiseLevelIndicator level={NaN} threshold={0.6} armed={false} />),
    ).not.toThrow();
  });
});
