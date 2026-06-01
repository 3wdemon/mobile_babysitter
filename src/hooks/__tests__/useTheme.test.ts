import { renderHook } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';

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
  });

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

  it('defaults to system mode and falls back to light when OS scheme is null', () => {
    mockedUseColorScheme.mockReturnValue(null);
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe(lightTheme);
  });
});
