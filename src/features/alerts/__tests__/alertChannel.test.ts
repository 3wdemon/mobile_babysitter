/**
 * Unit tests for alerts-over-WebRTC-datachannel (DMY-50).
 *
 * Covers the three acceptance criteria with an in-memory fake {@link DataChannel}
 * (no native bridge):
 *
 *  AC1 — a raised AlertEvent is serialized to a privacy-safe `{type,timestamp}`
 *        string and sent over the channel (no audio/frame/metric/soundId).
 *  AC2 — a VALID inbound message presents a local notification AND vibrates.
 *  AC3 — a malformed/unknown inbound message is dropped: no notification, no
 *        haptic, no throw.
 *
 * The presenter and haptic are spies plugging into the SAME injected contracts
 * production uses (DMY-46 / DMY-28).
 */
import {
  ALERT_CHANNEL_LABEL,
  serializeAlert,
  parseAlert,
  sendAlertOverChannel,
  receiveAlertsFromChannel,
  pushAlertsToChannel,
} from '../alertChannel';
import type { AlertNotificationPresenter } from '../notificationPresenter';
import type { HapticFeedback } from '../hapticFeedback';
import type { AlertEvent } from '../alertTypes';
import type { DataChannel } from '../../webrtc/signalingTypes';

/** In-memory fake DataChannel: records sends, lets a test push inbound messages. */
class FakeDataChannel implements DataChannel {
  readonly label = ALERT_CHANNEL_LABEL;
  readonly sent: string[] = [];
  open = true;
  private messageHandlers = new Set<(p: string) => void>();
  private closeHandlers = new Set<() => void>();

  send(payload: string): boolean {
    if (!this.open) {
      return false;
    }
    this.sent.push(payload);
    return true;
  }
  onMessage(handler: (p: string) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }
  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
  isOpen(): boolean {
    return this.open;
  }
  close(): void {
    this.open = false;
  }
  /** Test helper: simulate an inbound message. */
  receive(payload: string): void {
    for (const h of this.messageHandlers) {
      h(payload);
    }
  }
}

function makeSpyPresenter(): AlertNotificationPresenter & { present: jest.Mock } {
  return { present: jest.fn() };
}

function makeSpyHaptic(): HapticFeedback & { trigger: jest.Mock } {
  return { trigger: jest.fn() };
}

const cryEvent: AlertEvent = {
  type: 'cry',
  timestamp: 1_700_000_000_000,
  soundId: 'alert-cry',
};

describe('serializeAlert (privacy boundary)', () => {
  it('projects ONLY type + timestamp (drops soundId / any extra field)', () => {
    const json = serializeAlert(cryEvent);
    expect(JSON.parse(json)).toEqual({
      type: 'cry',
      timestamp: 1_700_000_000_000,
    });
    // No media/metric/soundId leaks onto the wire.
    expect(json).not.toContain('soundId');
    expect(json).not.toContain('alert-cry');
  });

  it('round-trips through parseAlert', () => {
    expect(parseAlert(serializeAlert(cryEvent))).toEqual({
      type: 'cry',
      timestamp: 1_700_000_000_000,
    });
  });
});

describe('parseAlert (strict validation)', () => {
  it('accepts each known alert type', () => {
    for (const type of ['cry', 'motion', 'noise', 'no_motion'] as const) {
      expect(parseAlert(JSON.stringify({ type, timestamp: 1 }))).toEqual({
        type,
        timestamp: 1,
      });
    }
  });

  it('ignores extra fields but keeps a valid type+timestamp', () => {
    const parsed = parseAlert(
      JSON.stringify({ type: 'noise', timestamp: 5, soundId: 'x', rms: 0.9 }),
    );
    expect(parsed).toEqual({ type: 'noise', timestamp: 5 });
  });

  it.each([
    ['non-JSON garbage', 'not json {'],
    ['empty string', ''],
    ['JSON null', 'null'],
    ['JSON array', '[1,2,3]'],
    ['JSON primitive', '42'],
    ['missing type', JSON.stringify({ timestamp: 1 })],
    ['unknown type', JSON.stringify({ type: 'explosion', timestamp: 1 })],
    ['numeric type', JSON.stringify({ type: 1, timestamp: 1 })],
    ['missing timestamp', JSON.stringify({ type: 'cry' })],
    ['string timestamp', JSON.stringify({ type: 'cry', timestamp: '1' })],
    ['NaN timestamp', JSON.stringify({ type: 'cry', timestamp: Number.NaN })],
    ['Infinity timestamp', '{"type":"cry","timestamp":1e999}'],
  ])('rejects %s -> null (no throw)', (_label, payload) => {
    expect(() => parseAlert(payload)).not.toThrow();
    expect(parseAlert(payload)).toBeNull();
  });
});

describe('sendAlertOverChannel (AC1 — baby side)', () => {
  it('sends the privacy-safe payload over an open channel', () => {
    const channel = new FakeDataChannel();
    expect(sendAlertOverChannel(channel, cryEvent)).toBe(true);
    expect(channel.sent).toHaveLength(1);
    expect(JSON.parse(channel.sent[0])).toEqual({
      type: 'cry',
      timestamp: 1_700_000_000_000,
    });
  });

  it('returns false when the channel is closed (drops, never throws)', () => {
    const channel = new FakeDataChannel();
    channel.close();
    expect(sendAlertOverChannel(channel, cryEvent)).toBe(false);
    expect(channel.sent).toHaveLength(0);
  });

  it('returns false for a null channel (data channels unavailable)', () => {
    expect(sendAlertOverChannel(null, cryEvent)).toBe(false);
  });
});

describe('receiveAlertsFromChannel (AC2/AC3 — parent side)', () => {
  it('AC2: a valid inbound alert presents a notification AND vibrates', () => {
    const channel = new FakeDataChannel();
    const presenter = makeSpyPresenter();
    const haptic = makeSpyHaptic();
    receiveAlertsFromChannel(channel, { presenter, haptic });

    channel.receive(serializeAlert(cryEvent));

    expect(presenter.present).toHaveBeenCalledTimes(1);
    expect(presenter.present.mock.calls[0][0]).toMatchObject({
      type: 'cry',
      timestamp: 1_700_000_000_000,
    });
    expect(haptic.trigger).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['non-JSON', 'garbage'],
    ['unknown type', JSON.stringify({ type: 'explosion', timestamp: 1 })],
    ['missing timestamp', JSON.stringify({ type: 'cry' })],
    ['JSON null', 'null'],
  ])(
    'AC3: a malformed/unknown message (%s) is dropped — no notify, no haptic, no throw',
    (_label, payload) => {
      const channel = new FakeDataChannel();
      const presenter = makeSpyPresenter();
      const haptic = makeSpyHaptic();
      receiveAlertsFromChannel(channel, { presenter, haptic });

      expect(() => channel.receive(payload)).not.toThrow();
      expect(presenter.present).not.toHaveBeenCalled();
      expect(haptic.trigger).not.toHaveBeenCalled();
    },
  );

  it('isolates a throwing presenter so the haptic still fires', () => {
    const channel = new FakeDataChannel();
    const presenter: AlertNotificationPresenter = {
      present: jest.fn(() => {
        throw new Error('present boom');
      }),
    };
    const haptic = makeSpyHaptic();
    receiveAlertsFromChannel(channel, { presenter, haptic });

    expect(() => channel.receive(serializeAlert(cryEvent))).not.toThrow();
    expect(haptic.trigger).toHaveBeenCalledTimes(1);
  });

  it('isolates a rejecting async presenter (no unhandled rejection escapes)', async () => {
    const channel = new FakeDataChannel();
    const presenter: AlertNotificationPresenter = {
      present: jest.fn(() => Promise.reject(new Error('async boom'))),
    };
    const haptic = makeSpyHaptic();
    receiveAlertsFromChannel(channel, { presenter, haptic });

    expect(() => channel.receive(serializeAlert(cryEvent))).not.toThrow();
    expect(haptic.trigger).toHaveBeenCalledTimes(1);
    // Let the rejection settle; the receiver swallows it.
    await Promise.resolve();
  });

  it('isolates a throwing haptic so the receiver does not blow up', () => {
    const channel = new FakeDataChannel();
    const presenter = makeSpyPresenter();
    const haptic: HapticFeedback = {
      trigger: jest.fn(() => {
        throw new Error('haptic boom');
      }),
    };
    receiveAlertsFromChannel(channel, { presenter, haptic });

    expect(() => channel.receive(serializeAlert(cryEvent))).not.toThrow();
    expect(presenter.present).toHaveBeenCalledTimes(1);
  });

  it('defaults to no-op sinks (no throw) when none injected', () => {
    const channel = new FakeDataChannel();
    receiveAlertsFromChannel(channel);
    expect(() => channel.receive(serializeAlert(cryEvent))).not.toThrow();
  });

  it('unsubscribes from the channel when the returned fn is called', () => {
    const channel = new FakeDataChannel();
    const presenter = makeSpyPresenter();
    const haptic = makeSpyHaptic();
    const off = receiveAlertsFromChannel(channel, { presenter, haptic });

    off();
    channel.receive(serializeAlert(cryEvent));
    expect(presenter.present).not.toHaveBeenCalled();
    expect(haptic.trigger).not.toHaveBeenCalled();
  });
});

describe('pushAlertsToChannel (baby-side source → channel, DMY-71)', () => {
  /** Minimal in-memory alert source the test drives. */
  function makeSource(): {
    source: { subscribe: (h: (e: AlertEvent) => void) => () => void };
    emit: (e: AlertEvent) => void;
    subscriberCount: () => number;
  } {
    const handlers = new Set<(e: AlertEvent) => void>();
    return {
      source: {
        subscribe(h) {
          handlers.add(h);
          return () => handlers.delete(h);
        },
      },
      emit(e) {
        for (const h of handlers) {
          h(e);
        }
      },
      subscriberCount: () => handlers.size,
    };
  }

  it('sends every raised AlertEvent over the channel (privacy-safe wire)', () => {
    const channel = new FakeDataChannel();
    const { source, emit } = makeSource();
    pushAlertsToChannel(channel, source);

    emit(cryEvent);
    expect(channel.sent).toEqual([serializeAlert(cryEvent)]);
    // No media/metric/soundId on the wire.
    expect(channel.sent[0]).not.toContain('alert-cry');
  });

  it('unsubscribes from the source when the returned fn is called', () => {
    const channel = new FakeDataChannel();
    const { source, emit, subscriberCount } = makeSource();
    const off = pushAlertsToChannel(channel, source);
    expect(subscriberCount()).toBe(1);

    off();
    expect(subscriberCount()).toBe(0);
    emit(cryEvent);
    expect(channel.sent).toHaveLength(0);
  });

  it('is a no-op subscription when the channel is null (unavailable)', () => {
    const { source, emit, subscriberCount } = makeSource();
    const off = pushAlertsToChannel(null, source);
    // Did NOT subscribe to the source — alerts-over-datachannel unavailable.
    expect(subscriberCount()).toBe(0);
    expect(() => {
      emit(cryEvent);
      off();
    }).not.toThrow();
  });
});
