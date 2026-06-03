/**
 * Module-resolution fallback tests for createNotifeePresenter (DMY-46).
 *
 * This is the AC: "notifee unavailable (Jest / bare JS) -> noop presenter, no
 * crash." The default factory `createNotifeePresenter()` lazily `require()`s the
 * native `@notifee/react-native` package; when that require throws (native
 * bridge unlinked / bare JS) or returns a malformed module, it must degrade to
 * the safe noop presenter rather than crash.
 *
 * Kept in its OWN file (not the main presenter suite) because it mutates the
 * module registry per-test via `jest.doMock` + `jest.isolateModules`; isolating
 * it guarantees the mutation cannot leak into the other presenter assertions. We
 * intentionally do NOT rely on the global manual mock here.
 */
import type { AlertEvent } from '../alertTypes';

const CRY_EVENT: AlertEvent = {
  type: 'cry',
  timestamp: 1_700_000_000_000,
  soundId: 'alert-cry',
};

describe('createNotifeePresenter — notifee unavailable / malformed', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('falls back to the noop presenter when require() throws', () => {
    jest.isolateModules(() => {
      jest.doMock('@notifee/react-native', () => {
        throw new Error('native module not linked');
      });
      const mod = require('../notificationPresenter');
      const presenter = mod.createNotifeePresenter();

      // Noop behaviour: presents nothing, never throws.
      expect(presenter).toBe(mod.noopNotificationPresenter);
      expect(() => presenter.present(CRY_EVENT)).not.toThrow();
    });
  });

  it('falls back to the noop presenter when the module is malformed', () => {
    jest.isolateModules(() => {
      // Resolves, but missing the createChannel/displayNotification API.
      jest.doMock('@notifee/react-native', () => ({ default: {} }));
      const mod = require('../notificationPresenter');
      const presenter = mod.createNotifeePresenter();
      expect(presenter).toBe(mod.noopNotificationPresenter);
      expect(() => presenter.present(CRY_EVENT)).not.toThrow();
    });
  });

  it('falls back to the noop presenter when the module default is null', () => {
    jest.isolateModules(() => {
      jest.doMock('@notifee/react-native', () => ({ default: null }));
      const mod = require('../notificationPresenter');
      const presenter = mod.createNotifeePresenter();
      expect(presenter).toBe(mod.noopNotificationPresenter);
    });
  });

  it('uses the real adapter when the module is well-formed', () => {
    jest.isolateModules(() => {
      const displayNotification = jest.fn(() => Promise.resolve('id'));
      jest.doMock('@notifee/react-native', () => ({
        default: {
          createChannel: jest.fn(() => Promise.resolve('ch')),
          displayNotification,
        },
      }));
      const mod = require('../notificationPresenter');
      const presenter = mod.createNotifeePresenter();
      // Not the noop — it actually drives the (fake) native module.
      expect(presenter).not.toBe(mod.noopNotificationPresenter);
      return presenter.present(CRY_EVENT).then(() => {
        expect(displayNotification).toHaveBeenCalledTimes(1);
      });
    });
  });
});
