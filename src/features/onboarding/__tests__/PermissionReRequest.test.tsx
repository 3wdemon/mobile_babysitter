/**
 * Tests for PermissionReRequest (DMY-57).
 *
 * The component owns a `usePermissions()` instance; we mock that hook so each
 * case can drive the per-permission statuses and assert the right affordance is
 * rendered and wired:
 *  - denied  -> "Grant" calls request()
 *  - blocked -> "Open settings" calls openSettings()
 *  - all granted -> no per-permission rows; the continue affordance is shown
 *    and `onAllGranted` fires.
 *
 * openSettings is the hook's responsibility to make non-throwing (covered in
 * usePermissions.test.ts); here we additionally assert the component does not
 * crash when it resolves `false` (open failed) — the guidance stays visible.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import PermissionReRequest from '../PermissionReRequest';
import { usePermissions } from '../usePermissions';
import type { UsePermissions } from '../usePermissions';
import type { PermissionStatuses } from '../types';

jest.mock('../usePermissions');

const mockUsePermissions = usePermissions as jest.MockedFunction<
  typeof usePermissions
>;

/** Build a usePermissions return value with overridable statuses/actions. */
function buildHook(
  statuses: PermissionStatuses,
  overrides: Partial<UsePermissions> = {},
): UsePermissions {
  return {
    statuses,
    requesting: false,
    request: jest.fn().mockResolvedValue(statuses),
    openSettings: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PermissionReRequest', () => {
  it('calls request() when a denied permission row Grant button is tapped', () => {
    const request = jest.fn().mockResolvedValue(undefined);
    mockUsePermissions.mockReturnValue(
      buildHook(
        { camera: 'denied', microphone: 'granted', notifications: 'granted' },
        { request },
      ),
    );

    render(<PermissionReRequest />);

    // The denied camera row exposes its name and a Grant action.
    expect(screen.getByText('Camera')).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText('Grant Camera permission'));

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reflects an updated status after request resolves (denied -> granted)', () => {
    const statuses: PermissionStatuses = {
      camera: 'denied',
      microphone: 'granted',
      notifications: 'granted',
    };
    mockUsePermissions.mockReturnValue(buildHook(statuses));

    const { rerender } = render(<PermissionReRequest />);
    expect(screen.getByText('Camera')).toBeOnTheScreen();

    // Simulate the hook re-rendering with the new (granted) status.
    mockUsePermissions.mockReturnValue(
      buildHook({
        camera: 'granted',
        microphone: 'granted',
        notifications: 'granted',
      }),
    );
    rerender(<PermissionReRequest />);

    // The camera row is gone; the all-granted state is shown instead.
    expect(screen.queryByText('Camera')).not.toBeOnTheScreen();
    expect(screen.getByText('All permissions granted.')).toBeOnTheScreen();
  });

  it('calls openSettings() with guidance when a blocked permission Open settings is tapped', () => {
    const openSettings = jest.fn().mockResolvedValue(true);
    mockUsePermissions.mockReturnValue(
      buildHook(
        { camera: 'blocked', microphone: 'granted', notifications: 'granted' },
        { openSettings },
      ),
    );

    render(<PermissionReRequest />);

    // Blocked guidance copy is shown alongside the Open settings action.
    expect(
      screen.getByText(
        'This was turned off and can only be re-enabled in your device Settings.',
      ),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByLabelText('Open settings to enable Camera'));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('does not crash and keeps guidance when openSettings resolves false (open failed)', async () => {
    const openSettings = jest.fn().mockResolvedValue(false);
    mockUsePermissions.mockReturnValue(
      buildHook(
        { camera: 'blocked', microphone: 'granted', notifications: 'granted' },
        { openSettings },
      ),
    );

    render(<PermissionReRequest />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Open settings to enable Camera'));
    });

    expect(openSettings).toHaveBeenCalledTimes(1);
    // Guidance + action remain on screen; the user can retry.
    expect(screen.getByLabelText('Open settings to enable Camera')).toBeOnTheScreen();
  });

  it('hides the re-request UI and shows the continue affordance when all granted', () => {
    const onAllGranted = jest.fn();
    mockUsePermissions.mockReturnValue(
      buildHook({
        camera: 'granted',
        microphone: 'granted',
        notifications: 'granted',
      }),
    );

    render(<PermissionReRequest onAllGranted={onAllGranted} />);

    expect(screen.queryByText('Camera')).not.toBeOnTheScreen();
    expect(screen.queryByText('Microphone')).not.toBeOnTheScreen();
    expect(screen.getByText('All permissions granted.')).toBeOnTheScreen();

    // The auto-fire on mount happens once.
    expect(onAllGranted).toHaveBeenCalledTimes(1);

    // Tapping Continue invokes the affordance again.
    fireEvent.press(screen.getByText('Continue'));
    expect(onAllGranted).toHaveBeenCalledTimes(2);
  });

  it('treats unavailable permissions as satisfied (not blocking all-granted)', () => {
    mockUsePermissions.mockReturnValue(
      buildHook({
        camera: 'granted',
        microphone: 'granted',
        notifications: 'unavailable',
      }),
    );

    render(<PermissionReRequest />);

    expect(screen.getByText('All permissions granted.')).toBeOnTheScreen();
    expect(screen.queryByText('Notifications')).not.toBeOnTheScreen();
  });
});
