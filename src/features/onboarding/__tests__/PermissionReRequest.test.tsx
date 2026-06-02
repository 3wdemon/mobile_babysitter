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

  it('auto-fires onAllGranted EXACTLY ONCE across re-renders with fresh callback identities', () => {
    let autoFireCount = 0;
    let continueTapCount = 0;

    const grantedStatuses: PermissionStatuses = {
      camera: 'granted',
      microphone: 'granted',
      notifications: 'granted',
    };
    mockUsePermissions.mockReturnValue(buildHook(grantedStatuses));

    // Every render passes a BRAND-NEW inline arrow (fresh identity each time).
    // Before the ref-latch fix this re-fired the auto-callback on each render.
    const { rerender } = render(
      <PermissionReRequest onAllGranted={() => (autoFireCount += 1)} />,
    );

    // Re-render several more times, each with a NEW callback identity, while
    // the statuses stay all-granted.
    rerender(<PermissionReRequest onAllGranted={() => (autoFireCount += 1)} />);
    rerender(<PermissionReRequest onAllGranted={() => (autoFireCount += 1)} />);
    rerender(<PermissionReRequest onAllGranted={() => (autoFireCount += 1)} />);

    // The auto-fire latch guarantees a single auto-fire across all renders.
    const AUTO_FIRE_COUNT = autoFireCount;
    expect(AUTO_FIRE_COUNT).toBe(1);

    // The user-initiated Continue tap is a separate path; it still fires.
    rerender(
      <PermissionReRequest onAllGranted={() => (continueTapCount += 1)} />,
    );
    fireEvent.press(screen.getByText('Continue'));
    expect(continueTapCount).toBe(1);

    // Auto-fire count remains untouched by the tap path.
    expect(autoFireCount).toBe(1);
  });

  it('re-fires auto onAllGranted once on a true->false->true transition (latch resets)', () => {
    const onAllGranted = jest.fn();
    const grantedStatuses: PermissionStatuses = {
      camera: 'granted',
      microphone: 'granted',
      notifications: 'granted',
    };
    const deniedStatuses: PermissionStatuses = {
      camera: 'denied',
      microphone: 'granted',
      notifications: 'granted',
    };

    // First all-granted transition: auto-fire once.
    mockUsePermissions.mockReturnValue(buildHook(grantedStatuses));
    const { rerender } = render(
      <PermissionReRequest onAllGranted={onAllGranted} />,
    );
    expect(onAllGranted).toHaveBeenCalledTimes(1);

    // Fall back out of all-granted (latch should reset, no fire).
    mockUsePermissions.mockReturnValue(buildHook(deniedStatuses));
    rerender(<PermissionReRequest onAllGranted={onAllGranted} />);
    expect(onAllGranted).toHaveBeenCalledTimes(1);

    // Second all-granted transition: auto-fire exactly once more.
    mockUsePermissions.mockReturnValue(buildHook(grantedStatuses));
    rerender(<PermissionReRequest onAllGranted={onAllGranted} />);
    expect(onAllGranted).toHaveBeenCalledTimes(2);
  });

  it('latch holds across multiple all-granted renders with fresh callbacks, both before AND after a true->false->true reset', () => {
    // This is the genuine regression guard for the reviewer-flagged latch:
    // it combines fresh inline callback identities (which the OLD effect deps
    // [allGranted, onAllGranted] re-fired on) WITH a true->false->true reset.
    // Each all-granted PHASE re-renders several times with a brand-new arrow;
    // only the ref+latch implementation produces exactly ONE auto-fire per
    // phase (the old code would fire on every fresh-identity render).
    let autoFireCount = 0;
    const fresh = () => () => {
      autoFireCount += 1;
    };

    const grantedStatuses: PermissionStatuses = {
      camera: 'granted',
      microphone: 'granted',
      notifications: 'granted',
    };
    const deniedStatuses: PermissionStatuses = {
      camera: 'denied',
      microphone: 'granted',
      notifications: 'granted',
    };

    // Phase 1: all-granted, rendered 3x with fresh callback identities.
    mockUsePermissions.mockReturnValue(buildHook(grantedStatuses));
    const { rerender } = render(<PermissionReRequest onAllGranted={fresh()} />);
    rerender(<PermissionReRequest onAllGranted={fresh()} />);
    rerender(<PermissionReRequest onAllGranted={fresh()} />);
    expect(autoFireCount).toBe(1);

    // Reset: fall out of all-granted, rendered 2x with fresh identities.
    mockUsePermissions.mockReturnValue(buildHook(deniedStatuses));
    rerender(<PermissionReRequest onAllGranted={fresh()} />);
    rerender(<PermissionReRequest onAllGranted={fresh()} />);
    expect(autoFireCount).toBe(1);

    // Phase 2: all-granted again, rendered 3x with fresh identities.
    mockUsePermissions.mockReturnValue(buildHook(grantedStatuses));
    rerender(<PermissionReRequest onAllGranted={fresh()} />);
    rerender(<PermissionReRequest onAllGranted={fresh()} />);
    rerender(<PermissionReRequest onAllGranted={fresh()} />);
    expect(autoFireCount).toBe(2);
  });

  it('shows BOTH a Grant action (denied) and an Open-settings action (blocked) wired to the right permissions when statuses are mixed', () => {
    const request = jest.fn().mockResolvedValue(undefined);
    const openSettings = jest.fn().mockResolvedValue(true);
    // camera blocked, microphone denied, notifications granted.
    mockUsePermissions.mockReturnValue(
      buildHook(
        { camera: 'blocked', microphone: 'denied', notifications: 'granted' },
        { request, openSettings },
      ),
    );

    render(<PermissionReRequest />);

    // The granted permission is not shown.
    expect(screen.queryByText('Notifications')).not.toBeOnTheScreen();

    // Blocked camera -> Open settings (NOT a Grant button); guidance is blocked copy.
    expect(screen.getByText('Camera')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Open settings to enable Camera'),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('Grant Camera permission')).toBeNull();

    // Denied microphone -> Grant (NOT an Open-settings button).
    expect(screen.getByText('Microphone')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Grant Microphone permission'),
    ).toBeOnTheScreen();
    expect(
      screen.queryByLabelText('Open settings to enable Microphone'),
    ).toBeNull();

    // Each action is wired to the correct hook method, exactly once.
    fireEvent.press(screen.getByLabelText('Open settings to enable Camera'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Grant Microphone permission'));
    expect(request).toHaveBeenCalledTimes(1);
    // openSettings not called again by the Grant tap.
    expect(openSettings).toHaveBeenCalledTimes(1);
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
