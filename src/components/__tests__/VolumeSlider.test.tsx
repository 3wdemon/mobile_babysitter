/**
 * Tests for VolumeSlider (DMY-56).
 *
 * Asserts: it renders the stepped track + −/+ controls; pressing increment /
 * decrement emits a clamped, snapped 0..1 value through onChange; it never
 * emits below 0 or above 1 (clamped); the whole control is an `adjustable`
 * element with a percentage `accessibilityValue` and increment/decrement
 * actions that drive onChange; and volume 0 surfaces the muted state.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import VolumeSlider, { VOLUME_STEPS } from '../VolumeSlider';
import { t } from '../../services/i18n';

const STEP = 1 / (VOLUME_STEPS - 1);

describe('VolumeSlider (DMY-56)', () => {
  it('renders the adjustable control with the volume label', () => {
    render(<VolumeSlider volume={0.5} onChange={jest.fn()} />);
    expect(screen.getByTestId('volume-slider')).toBeTruthy();
    expect(screen.getByTestId('volume-decrement')).toBeTruthy();
    expect(screen.getByTestId('volume-increment')).toBeTruthy();
    // One track segment per discrete step.
    for (let i = 0; i < VOLUME_STEPS; i += 1) {
      expect(screen.getByTestId(`volume-step-${i}`)).toBeTruthy();
    }
  });

  it('exposes an adjustable a11y role with a percentage value', () => {
    render(<VolumeSlider volume={0.5} onChange={jest.fn()} />);
    const slider = screen.getByTestId('volume-slider');
    expect(slider.props.accessibilityRole).toBe('adjustable');
    expect(slider.props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 50,
      text: t('volume.valueA11y', { percent: 50 }),
    });
  });

  it('increment dispatches the next step up through onChange', () => {
    const onChange = jest.fn();
    render(<VolumeSlider volume={0.5} onChange={onChange} />);
    fireEvent.press(screen.getByTestId('volume-increment'));
    expect(onChange).toHaveBeenCalledWith(0.5 + STEP);
  });

  it('decrement dispatches the next step down through onChange', () => {
    const onChange = jest.fn();
    render(<VolumeSlider volume={0.5} onChange={onChange} />);
    fireEvent.press(screen.getByTestId('volume-decrement'));
    expect(onChange).toHaveBeenCalledWith(0.5 - STEP);
  });

  it('clamps at the top: incrementing at max does not emit > 1', () => {
    const onChange = jest.fn();
    render(<VolumeSlider volume={1} onChange={onChange} />);
    fireEvent.press(screen.getByTestId('volume-increment'));
    // Already at 1 -> snapped next value equals current -> no emit.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clamps at the bottom: decrementing at 0 does not emit < 0', () => {
    const onChange = jest.fn();
    render(<VolumeSlider volume={0} onChange={onChange} />);
    fireEvent.press(screen.getByTestId('volume-decrement'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a11y increment/decrement actions drive onChange', () => {
    const onChange = jest.fn();
    render(<VolumeSlider volume={0.5} onChange={onChange} />);
    const slider = screen.getByTestId('volume-slider');

    fireEvent(slider, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(onChange).toHaveBeenLastCalledWith(0.5 + STEP);

    fireEvent(slider, 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    expect(onChange).toHaveBeenLastCalledWith(0.5 - STEP);
  });

  it('surfaces the muted state at volume 0 (mute, not disconnect copy)', () => {
    render(<VolumeSlider volume={0} onChange={jest.fn()} />);
    expect(screen.getByText(t('volume.muted'))).toBeTruthy();
    // a11y value reads 0 percent, not a disconnected/absent control.
    expect(
      screen.getByTestId('volume-slider').props.accessibilityValue.now,
    ).toBe(0);
  });

  it('shows a percentage value when audible', () => {
    render(<VolumeSlider volume={0.75} onChange={jest.fn()} />);
    expect(screen.getByText(t('volume.value', { percent: 75 }))).toBeTruthy();
  });

  it('snaps an off-step persisted value to the nearest step for display', () => {
    // 0.6 is between 0.5 and 0.75; nearest step is 0.5 -> 50%.
    render(<VolumeSlider volume={0.6} onChange={jest.fn()} />);
    expect(
      screen.getByTestId('volume-slider').props.accessibilityValue.now,
    ).toBe(50);
  });
});
