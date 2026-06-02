/**
 * Unit tests for TalkButton (DMY-20) — the parent push-to-talk control.
 *
 * Verifies: press-in starts talking and press-out stops it (push-to-talk),
 * the TALKING indicator reflects the real `talking` prop (never fabricated),
 * the disabled state makes the control inert, and labels are honest.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import TalkButton from '../TalkButton';

describe('TalkButton', () => {
  it('calls onStartTalking on press-in and onStopTalking on press-out (push-to-talk)', () => {
    const onStartTalking = jest.fn();
    const onStopTalking = jest.fn();
    render(
      <TalkButton
        talking={false}
        onStartTalking={onStartTalking}
        onStopTalking={onStopTalking}
      />,
    );

    const button = screen.getByTestId('talk-button');
    fireEvent(button, 'pressIn');
    expect(onStartTalking).toHaveBeenCalledTimes(1);
    expect(onStopTalking).not.toHaveBeenCalled();

    fireEvent(button, 'pressOut');
    expect(onStopTalking).toHaveBeenCalledTimes(1);
  });

  it('shows the TALKING indicator only when talking is true', () => {
    const { rerender } = render(
      <TalkButton
        talking={false}
        onStartTalking={jest.fn()}
        onStopTalking={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('talk-indicator')).toBeNull();
    expect(screen.getByText('Hold to talk')).toBeTruthy();

    rerender(
      <TalkButton
        talking={true}
        onStartTalking={jest.fn()}
        onStopTalking={jest.fn()}
      />,
    );
    expect(screen.getByTestId('talk-indicator')).toBeTruthy();
    expect(screen.getByText('Talking…')).toBeTruthy();
  });

  it('is inert when disabled (no callbacks fire) and shows the unavailable hint', () => {
    const onStartTalking = jest.fn();
    const onStopTalking = jest.fn();
    render(
      <TalkButton
        talking={false}
        disabled
        onStartTalking={onStartTalking}
        onStopTalking={onStopTalking}
      />,
    );

    const button = screen.getByTestId('talk-button');
    fireEvent(button, 'pressIn');
    fireEvent(button, 'pressOut');
    expect(onStartTalking).not.toHaveBeenCalled();
    expect(onStopTalking).not.toHaveBeenCalled();
    expect(
      screen.getByText(/available once the connection is up/i),
    ).toBeTruthy();
  });
});
