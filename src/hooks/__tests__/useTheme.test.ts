import { act, renderHook } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';

import { useAppStore } from '../../store/useAppStore';
import { darkTheme, lightTheme } from '../../theme';
import { useTheme } from '../useTheme';

jest.mock('react-native', () => ({
  useColorScheme: jest.fn(),
}));

type ColorScheme = 'light' | 'dark' | null;

const mockedUseColorScheme = useColorScheme as unknown as jest.Mock<ColorScheme>;

describe('useTheme', () => {
  beforeEach(() => {
    mockedUseColorScheme.mockReset();
    // Reset the store to defaults (theme = 'system') between tests so the
    // persisted-preference path starts from a known state.
    useAppStore.getState().reset();
  });

  describe('explicit mode (prop-seam override)', () => {
    it('returns the dark theme when mode="dark" regardless of OS scheme', () => {
      mockedUseColorScheme.mockReturnValue('light');
      const { result } = renderHook(() => useTheme('dark'));
      expect(result.current).toBe(darkTheme);
      expect(result.current.scheme).toBe('dark');
    });

    it('returns the light theme when mode="light" regardless of OS scheme', () => {
      mockedUseColorScheme.mockReturnValue('dark');
      const { result } = renderHook(() => useTheme('light'));
      expect(result.current).toBe(lightTheme);
      expect(result.current.scheme).toBe('light');
    });

    it('follows the OS scheme when mode="system" (dark)', () => {
      mockedUseColorScheme.mockReturnValue('dark');
      const { result } = renderHook(() => useTheme('system'));
      expect(result.current).toBe(darkTheme);
    });

    it('follows the OS scheme when mode="system" (light)', () => {
      mockedUseColorScheme.mockReturnValue('light');
      const { result } = renderHook(() => useTheme('system'));
      expect(result.current).toBe(lightTheme);
    });

    it('overrides the persisted preference when an explicit mode is given', () => {
      mockedUseColorScheme.mockReturnValue('dark');
      // Store says light, explicit mode says dark -> explicit wins.
      useAppStore.getState().setTheme('light');
      const { result } = renderHook(() => useTheme('dark'));
      expect(result.current).toBe(darkTheme);
    });
  });

  describe('persisted preference (default, no argument)', () => {
    it('reflects a persisted light preference regardless of OS scheme', () => {
      mockedUseColorScheme.mockReturnValue('dark');
      useAppStore.getState().setTheme('light');
      const { result } = renderHook(() => useTheme());
      expect(result.current).toBe(lightTheme);
    });

    it('reflects a persisted dark preference regardless of OS scheme', () => {
      mockedUseColorScheme.mockReturnValue('light');
      useAppStore.getState().setTheme('dark');
      const { result } = renderHook(() => useTheme());
      expect(result.current).toBe(darkTheme);
    });

    it('follows the OS scheme when the persisted preference is "system" (dark)', () => {
      mockedUseColorScheme.mockReturnValue('dark');
      useAppStore.getState().setTheme('system');
      const { result } = renderHook(() => useTheme());
      expect(result.current).toBe(darkTheme);
    });

    it('follows the OS scheme when the persisted preference is "system" (light)', () => {
      mockedUseColorScheme.mockReturnValue('light');
      useAppStore.getState().setTheme('system');
      const { result } = renderHook(() => useTheme());
      expect(result.current).toBe(lightTheme);
    });

    it('defaults to system and falls back to light when OS scheme is null', () => {
      mockedUseColorScheme.mockReturnValue(null);
      // Default store preference is 'system'.
      const { result } = renderHook(() => useTheme());
      expect(result.current).toBe(lightTheme);
    });

    it('re-resolves when the persisted preference changes', () => {
      mockedUseColorScheme.mockReturnValue('light');
      const { result } = renderHook(() => useTheme());
      expect(result.current).toBe(lightTheme);

      // The store change drives a re-render through the subscription, so the
      // hook re-resolves without an explicit rerender call.
      act(() => {
        useAppStore.getState().setTheme('dark');
      });
      expect(result.current).toBe(darkTheme);
    });
  });
});
