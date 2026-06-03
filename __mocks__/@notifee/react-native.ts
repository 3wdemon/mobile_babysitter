/**
 * Jest mock for `@notifee/react-native` (DMY-46).
 *
 * The real library posts local notifications through a native module with no JS
 * fallback under Jest. This mock implements only the surface the notification
 * presenter consumes — `createChannel`, `displayNotification` and
 * `cancelAllNotifications` — as inert, resolved-promise spies so any test that
 * builds the real notifee presenter runs without touching native code.
 *
 * Tests can inspect the spies and reset them:
 *   - `createChannel` / `displayNotification` / `cancelAllNotifications` — spies.
 *   - `__reset()` — clear all spy call history.
 *
 * Note: presenter unit tests drive the seam directly via a fake module
 * (`createPresenterFromNotifee`); this mock exists so the `require()`-guarded
 * `createNotifeePresenter()` and any screen that builds it stay native-free.
 */

const createChannel = jest.fn((channel: { id: string }) =>
  Promise.resolve(channel.id),
);

const displayNotification = jest.fn(() => Promise.resolve('notification-id'));

const cancelAllNotifications = jest.fn(() => Promise.resolve());

/** Test helper: clear all spy call history. */
export function __reset(): void {
  createChannel.mockClear();
  displayNotification.mockClear();
  cancelAllNotifications.mockClear();
}

export default { createChannel, displayNotification, cancelAllNotifications };
