/**
 * Unit tests for ParentMediaView (DMY-24).
 *
 * Verifies: audio-only shows a tap-to-peek placeholder instead of video, a tap
 * peeks at the video surface and "Back to audio-only" returns, the toggle reads
 * and writes the persisted store setting, full-video mode shows the video
 * surface, and the surface is styled from the DARK/night tokens.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import ParentMediaView from '../ParentMediaView';
import { DARK_COLORS } from '../../../theme';
import { useAppStore } from '../../../store/useAppStore';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

describe('ParentMediaView', () => {
  beforeEach(() => {
    __resetAllMmkv();
    useAppStore.getState().reset();
  });

  it('shows the audio-only placeholder (not video) by default', () => {
    render(<ParentMediaView />);
    expect(screen.getByTestId('parent-audio-only-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('parent-video-surface')).toBeNull();
  });

  it('peeks at video on tap and returns to audio-only', () => {
    render(<ParentMediaView />);

    fireEvent.press(screen.getByTestId('parent-audio-only-placeholder'));
    expect(screen.getByTestId('parent-video-surface')).toBeTruthy();
    expect(screen.getByText(/peeking/i)).toBeTruthy();

    fireEvent.press(screen.getByTestId('parent-hide-video'));
    expect(screen.getByTestId('parent-audio-only-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('parent-video-surface')).toBeNull();
  });

  it('reflects the audio-only setting on the toggle', () => {
    render(<ParentMediaView />);
    expect(screen.getByTestId('audio-only-toggle').props.value).toBe(true);
  });

  it('writes the store setting when the toggle is flipped off', () => {
    render(<ParentMediaView />);
    fireEvent(screen.getByTestId('audio-only-toggle'), 'valueChange', false);
    expect(useAppStore.getState().settings.audioOnlyEnabled).toBe(false);
  });

  it('shows the video surface when audio-only is disabled', () => {
    useAppStore.getState().setAudioOnlyEnabled(false);
    render(<ParentMediaView />);
    expect(screen.getByTestId('parent-video-surface')).toBeTruthy();
    expect(screen.queryByTestId('parent-audio-only-placeholder')).toBeNull();
  });

  it('renders the container against the night palette (dark tokens)', () => {
    useAppStore.getState().setAudioOnlyEnabled(false);
    render(<ParentMediaView />);
    const surface = screen.getByTestId('parent-video-surface');
    expect(surface.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: DARK_COLORS.surface }),
      ]),
    );
  });
});
