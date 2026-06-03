/**
 * Unit tests for the local-notification presenter (DMY-46).
 *
 * Covers the seam end-to-end WITHOUT the native bridge:
 *  - each AlertType maps to the correct, TYPE-ONLY title/body (privacy: no
 *    audio/frame/metric/timestamp/soundId leaks into the notification),
 *  - the Android channel is created idempotently,
 *  - the shipped noop is a safe no-op,
 *  - a notifee call failure is swallowed (never throws into the pipeline).
 *
 * The require()-guarded `createNotifeePresenter()` fallback lives in its own
 * file (createNotifeePresenter.fallback.test.ts) so its module-registry mutation
 * cannot leak here.
 */
import { t } from '../../../services/i18n';
import type { AlertEvent, AlertType } from '../alertTypes';
import {
  ALERT_CHANNEL_ID,
  createPresenterFromNotifee,
  noopNotificationPresenter,
  createNoopNotificationPresenter,
  notificationContentForType,
  type NotifeeLike,
} from '../notificationPresenter';

const ALL_TYPES: AlertType[] = ['cry', 'motion', 'noise', 'no_motion'];

function makeEvent(type: AlertType): AlertEvent {
  return { type, timestamp: 1_700_000_000_000, soundId: `alert-${type}` };
}

interface DisplayCall {
  title?: string;
  body?: string;
  android?: { channelId: string };
}

function makeFakeNotifee(): NotifeeLike & {
  createChannel: jest.Mock;
  displayNotification: jest.Mock;
  cancelAllNotifications: jest.Mock;
} {
  return {
    createChannel: jest.fn((c: { id: string }) => Promise.resolve(c.id)),
    displayNotification: jest.fn(() => Promise.resolve('id')),
    cancelAllNotifications: jest.fn(() => Promise.resolve()),
  };
}

describe('notificationContentForType — type-only mapping (privacy)', () => {
  it.each(ALL_TYPES)('maps %s to its translated title/body', type => {
    const content = notificationContentForType(type);
    expect(content.title).toBe(t(`alerts.notification.${type}.title`));
    expect(content.body).toBe(t(`alerts.notification.${type}.body`));
    expect(content.title.length).toBeGreaterThan(0);
    expect(content.body.length).toBeGreaterThan(0);
  });

  it('produces a DISTINCT title per type', () => {
    const titles = ALL_TYPES.map(t2 => notificationContentForType(t2).title);
    expect(new Set(titles).size).toBe(ALL_TYPES.length);
  });
});

describe('createPresenterFromNotifee — present()', () => {
  it.each(ALL_TYPES)(
    'presents the correct TYPE-ONLY notification for %s',
    async type => {
      const notifee = makeFakeNotifee();
      const presenter = createPresenterFromNotifee(notifee);

      await presenter.present(makeEvent(type));

      expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
      const arg = notifee.displayNotification.mock
        .calls[0][0] as DisplayCall;
      expect(arg.title).toBe(t(`alerts.notification.${type}.title`));
      expect(arg.body).toBe(t(`alerts.notification.${type}.body`));
      expect(arg.android?.channelId).toBe(ALERT_CHANNEL_ID);
    },
  );

  it('never leaks audio/frame/metric/timestamp/soundId into the notification', async () => {
    const notifee = makeFakeNotifee();
    const presenter = createPresenterFromNotifee(notifee);

    // A deliberately "loud" event: a recognisable soundId + timestamp that must
    // NOT appear anywhere in the posted notification payload.
    const event: AlertEvent = {
      type: 'cry',
      timestamp: 1_700_000_123_456,
      soundId: 'alert-cry-SECRET-ASSET',
    };
    await presenter.present(event);

    const serialized = JSON.stringify(
      notifee.displayNotification.mock.calls[0][0],
    );
    // No raw metric/media vocabulary.
    expect(serialized).not.toMatch(
      /audio|buffer|pcm|frame|pixel|metric|level|loud|wav|mp3/i,
    );
    // No soundId / timestamp from the event leaked into the surface.
    expect(serialized).not.toContain('SECRET-ASSET');
    expect(serialized).not.toContain('alert-cry');
    expect(serialized).not.toContain(String(event.timestamp));
  });

  it('creates the channel ONCE across multiple presents (idempotent)', async () => {
    const notifee = makeFakeNotifee();
    const presenter = createPresenterFromNotifee(notifee);

    await presenter.present(makeEvent('cry'));
    await presenter.present(makeEvent('motion'));
    await presenter.present(makeEvent('noise'));

    expect(notifee.createChannel).toHaveBeenCalledTimes(1);
    expect(notifee.createChannel.mock.calls[0][0].id).toBe(ALERT_CHANNEL_ID);
    expect(notifee.displayNotification).toHaveBeenCalledTimes(3);
  });

  it('swallows a displayNotification rejection — never throws into the pipeline', async () => {
    const notifee = makeFakeNotifee();
    notifee.displayNotification.mockRejectedValueOnce(new Error('denied'));
    const presenter = createPresenterFromNotifee(notifee);

    await expect(presenter.present(makeEvent('cry'))).resolves.toBeUndefined();
  });

  it('swallows a createChannel throw and retries the channel next time', async () => {
    const notifee = makeFakeNotifee();
    notifee.createChannel.mockImplementationOnce(() => {
      throw new Error('no channel');
    });
    const presenter = createPresenterFromNotifee(notifee);

    // First present fails at channel creation but does not throw.
    await expect(presenter.present(makeEvent('cry'))).resolves.toBeUndefined();
    // A subsequent present retries the channel (the failed attempt was cleared).
    await presenter.present(makeEvent('cry'));
    expect(notifee.createChannel).toHaveBeenCalledTimes(2);
    expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
  });

  it('cancelAll delegates to notifee and swallows failures', async () => {
    const notifee = makeFakeNotifee();
    const presenter = createPresenterFromNotifee(notifee);
    await presenter.cancelAll?.();
    expect(notifee.cancelAllNotifications).toHaveBeenCalledTimes(1);

    notifee.cancelAllNotifications.mockRejectedValueOnce(new Error('boom'));
    await expect(presenter.cancelAll?.()).resolves.toBeUndefined();
  });

  it('tolerates a notifee without cancelAllNotifications', async () => {
    const notifee = makeFakeNotifee();
    // Drop the optional method.
    delete (notifee as { cancelAllNotifications?: unknown })
      .cancelAllNotifications;
    const presenter = createPresenterFromNotifee(notifee);
    await expect(presenter.cancelAll?.()).resolves.toBeUndefined();
  });
});

describe('noopNotificationPresenter', () => {
  it('is a safe no-op that presents nothing and never throws', () => {
    expect(() =>
      noopNotificationPresenter.present(makeEvent('cry')),
    ).not.toThrow();
  });

  it('createNoopNotificationPresenter returns the shared noop', () => {
    expect(createNoopNotificationPresenter()).toBe(noopNotificationPresenter);
  });
});
