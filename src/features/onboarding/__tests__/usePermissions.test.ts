/**
 * Unit tests for the usePermissions abstraction (DMY-42).
 *
 * react-native-permissions is mocked globally (jest.setup.js -> manual mock in
 * __mocks__). Here we drive that mock per-case to assert the hook maps native
 * results to our domain statuses, requests notifications via the dedicated API,
 * and never throws on a native failure (so the onboarding flow can continue).
 */
import { Linking } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import {
  RESULTS,
  requestMultiple,
  requestNotifications,
} from 'react-native-permissions';

import { usePermissions } from '../usePermissions';

const mockRequestMultiple = requestMultiple as jest.MockedFunction<
  typeof requestMultiple
>;
const mockRequestNotifications = requestNotifications as jest.MockedFunction<
  typeof requestNotifications
>;

describe('usePermissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-establish the default (all-granted) behaviour cleared above.
    mockRequestMultiple.mockImplementation(async (permissions: string[]) => {
      const result: Record<string, string> = {};
      for (const p of permissions) result[p] = RESULTS.GRANTED;
      return result as never;
    });
    mockRequestNotifications.mockResolvedValue({
      status: RESULTS.GRANTED,
    } as never);
  });

  it('starts with all statuses denied (not yet asked)', () => {
    const { result } = renderHook(() => usePermissions());
    expect(result.current.statuses).toEqual({
      camera: 'denied',
      microphone: 'denied',
      notifications: 'denied',
    });
    expect(result.current.requesting).toBe(false);
  });

  it('maps a fully granted result to granted statuses', async () => {
    const { result } = renderHook(() => usePermissions());

    await act(async () => {
      await result.current.request();
    });

    expect(result.current.statuses).toEqual({
      camera: 'granted',
      microphone: 'granted',
      notifications: 'granted',
    });
    expect(mockRequestMultiple).toHaveBeenCalledTimes(1);
    expect(mockRequestNotifications).toHaveBeenCalledTimes(1);
  });

  it('normalises blocked / denied / unavailable results', async () => {
    mockRequestMultiple.mockImplementation(async (permissions: string[]) => {
      const [cameraKey, micKey] = permissions;
      return {
        [cameraKey]: RESULTS.BLOCKED,
        [micKey]: RESULTS.DENIED,
      } as never;
    });
    mockRequestNotifications.mockResolvedValue({
      status: RESULTS.UNAVAILABLE,
    } as never);

    const { result } = renderHook(() => usePermissions());
    await act(async () => {
      await result.current.request();
    });

    expect(result.current.statuses).toEqual({
      camera: 'blocked',
      microphone: 'denied',
      notifications: 'unavailable',
    });
  });

  it('treats limited notifications as granted', async () => {
    mockRequestNotifications.mockResolvedValue({
      status: RESULTS.LIMITED,
    } as never);

    const { result } = renderHook(() => usePermissions());
    await act(async () => {
      await result.current.request();
    });

    expect(result.current.statuses.notifications).toBe('granted');
  });

  it('never throws and falls back to denied when the native call rejects', async () => {
    mockRequestMultiple.mockRejectedValue(new Error('native bridge error'));

    const { result } = renderHook(() => usePermissions());

    let resolved: Awaited<ReturnType<typeof result.current.request>> | undefined;
    await act(async () => {
      resolved = await result.current.request();
    });

    expect(resolved).toEqual({
      camera: 'denied',
      microphone: 'denied',
      notifications: 'denied',
    });
    expect(result.current.requesting).toBe(false);
  });

  describe('openSettings (DMY-57)', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('opens the OS settings screen and resolves true', async () => {
      const spy = jest
        .spyOn(Linking, 'openSettings')
        .mockResolvedValue(undefined);

      const { result } = renderHook(() => usePermissions());

      let opened: boolean | undefined;
      await act(async () => {
        opened = await result.current.openSettings();
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(opened).toBe(true);
    });

    it('never throws and resolves false when openSettings rejects', async () => {
      jest
        .spyOn(Linking, 'openSettings')
        .mockRejectedValue(new Error('no settings activity'));

      const { result } = renderHook(() => usePermissions());

      let opened: boolean | undefined;
      await act(async () => {
        opened = await result.current.openSettings();
      });

      expect(opened).toBe(false);
    });
  });
});
