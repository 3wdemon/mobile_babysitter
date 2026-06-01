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

  it('renders RTCView with the remote stream URL when video is live (DMY-17)', () => {
    useAppStore.getState().setAudioOnlyEnabled(false);
    render(<ParentMediaView remoteStreamUrl="rtc://remote-1" />);
    const video = screen.getByTestId('parent-remote-video');
    // The real RTCView (mocked) receives the remote stream id.
    expect(video.props.streamURL).toBe('rtc://remote-1');
    // No "connecting" placeholder hint when the live picture is up.
    expect(screen.queryByText(/appears here once the connection/i)).toBeNull();
  });

  it('shows the placeholder (no RTCView) until a real remote stream arrives', () => {
    useAppStore.getState().setAudioOnlyEnabled(false);
    render(<ParentMediaView remoteStreamUrl={null} />);
    // Honest placeholder, never a faked video surface.
    expect(screen.queryByTestId('parent-remote-video')).toBeNull();
    expect(screen.getByText(/appears here once the connection/i)).toBeTruthy();
  });

  it('does not render video in audio-only mode even if a stream URL is present', () => {
    // audioOnlyEnabled defaults to true.
    render(<ParentMediaView remoteStreamUrl="rtc://remote-1" />);
    expect(screen.queryByTestId('parent-remote-video')).toBeNull();
    expect(screen.getByTestId('parent-audio-only-placeholder')).toBeTruthy();
  });
});
