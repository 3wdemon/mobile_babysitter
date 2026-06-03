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
    // The caption is hidden from assistive tech (DMY-65), so the text query
    // must opt into hidden elements to see the visible label.
    expect(
      screen.getByText('Hold to talk', { includeHiddenElements: true }),
    ).toBeTruthy();

    rerender(
      <TalkButton
        talking={true}
        onStartTalking={jest.fn()}
        onStopTalking={jest.fn()}
      />,
    );
    expect(screen.getByTestId('talk-indicator')).toBeTruthy();
    expect(
      screen.getByText('Talking…', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('exposes a descriptive button label + role (a11y), not the raw caption (DMY-65)', () => {
    const { rerender } = render(
      <TalkButton
        talking={false}
        onStartTalking={jest.fn()}
        onStopTalking={jest.fn()}
      />,
    );

    // Icon-only-style control: the screen reader gets the full descriptive
    // label from the catalog, queried by role + accessible name.
    const idle = screen.getByRole('button', {
      name: 'Hold to talk to the baby unit',
    });
    expect(idle).toBeTruthy();
    expect(idle.props.accessibilityState).toMatchObject({
      disabled: false,
      busy: false,
    });

    rerender(
      <TalkButton
        talking={true}
        onStartTalking={jest.fn()}
        onStopTalking={jest.fn()}
      />,
    );
    const talkingBtn = screen.getByRole('button', {
      name: 'Talking — release to stop',
    });
    expect(talkingBtn.props.accessibilityState).toMatchObject({ busy: true });

    // The TALKING indicator announces a meaningful label, and its decorative
    // status dot is hidden from assistive tech.
    const indicator = screen.getByLabelText('Talking to the baby unit');
    expect(indicator).toBeTruthy();
  });

  it('hides the decorative caption/dot from assistive tech (no double-read)', () => {
    render(
      <TalkButton
        talking
        onStartTalking={jest.fn()}
        onStopTalking={jest.fn()}
      />,
    );
    // The visible caption inside the button is hidden so the button's own
    // label is the single announced string.
    const caption = screen.getByText('Talking…', {
      includeHiddenElements: true,
    });
    expect(caption.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(caption.props.accessibilityElementsHidden).toBe(true);
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
