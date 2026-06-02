/**
 * Unit tests for the alert orchestration core (DMY-26).
 *
 * Uses a spy {@link AlertSoundPlayer} and an injected clock so mapping, throttle,
 * dedup and priority are fully deterministic without React or real timers.
 */
import { createAlertService } from '../alertService';
import { soundIdForType } from '../alertSoundMap';
import type { AlertSoundPlayer } from '../alertTypes';

function makeSpyPlayer(): AlertSoundPlayer & {
  playSound: jest.Mock;
  stop: jest.Mock;
} {
  return {
    playSound: jest.fn(),
    stop: jest.fn(),
  };
}

/** A controllable clock starting at `0`. */
function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

describe('AlertService — mapping (core AC)', () => {
  it('plays a DIFFERENT sound for cry, motion and noise', () => {
    const player = makeSpyPlayer();
    const clock = makeClock();
    const service = createAlertService({ player, now: clock.now });

    service.handle('cry');
    clock.advance(60000);
    service.handle('motion');
    clock.advance(60000);
    service.handle('noise');

    const playedIds = player.playSound.mock.calls.map(c => c[0]);
    expect(playedIds).toEqual([
      soundIdForType('cry'),
      soundIdForType('motion'),
      soundIdForType('noise'),
    ]);
    // All distinct.
    expect(new Set(playedIds).size).toBe(3);
  });

  it('plays a distinct no_motion sound too', () => {
    const player = makeSpyPlayer();
    const service = createAlertService({ player, now: () => 0 });
    service.handle('no_motion');
    expect(player.playSound).toHaveBeenCalledWith(
      soundIdForType('no_motion'),
      expect.anything(),
    );
  });

  it('returns the raised AlertEvent with type + soundId, no media fields', () => {
    const player = makeSpyPlayer();
    const service = createAlertService({ player, now: () => 1234 });
    const { event } = service.handle('cry');
    expect(event).toEqual({
      type: 'cry',
      timestamp: 1234,
      soundId: soundIdForType('cry'),
    });
  });
});

describe('AlertService — enablement', () => {
  it('plays nothing when alerts are disabled', () => {
    const player = makeSpyPlayer();
    const service = createAlertService({
      player,
      isEnabled: () => false,
      now: () => 0,
    });
    const result = service.handle('cry');
    expect(player.playSound).not.toHaveBeenCalled();
    expect(result.event).toBeNull();
    expect(result.droppedReason).toBe('disabled');
  });

  it('honours enablement live (reads the predicate each call)', () => {
    const player = makeSpyPlayer();
    let enabled = false;
    const service = createAlertService({
      player,
      isEnabled: () => enabled,
      now: () => 0,
    });

    expect(service.handle('cry').droppedReason).toBe('disabled');
    enabled = true;
    expect(service.handle('cry').event).not.toBeNull();
    expect(player.playSound).toHaveBeenCalledTimes(1);
  });
});

describe('AlertService — throttle / dedup', () => {
  it('drops a repeat of the same type within its cooldown', () => {
    const player = makeSpyPlayer();
    const clock = makeClock();
    const service = createAlertService({ player, now: clock.now });

    expect(service.handle('noise').event).not.toBeNull();
    clock.advance(1000); // well within noise cooldown
    const second = service.handle('noise');

    expect(second.event).toBeNull();
    expect(second.droppedReason).toBe('cooldown');
    expect(player.playSound).toHaveBeenCalledTimes(1);
  });

  it('allows the same type again after its cooldown elapses', () => {
    const player = makeSpyPlayer();
    const clock = makeClock();
    const service = createAlertService({ player, now: clock.now });

    service.handle('noise');
    clock.advance(8000); // == noise cooldown
    const again = service.handle('noise');

    expect(again.event).not.toBeNull();
    expect(player.playSound).toHaveBeenCalledTimes(2);
  });

  it('cooldown is per-type: a different type is not throttled', () => {
    const player = makeSpyPlayer();
    const service = createAlertService({ player, now: () => 0 });

    expect(service.handle('motion').event).not.toBeNull();
    // cry is higher priority and a different type -> allowed immediately.
    expect(service.handle('cry').event).not.toBeNull();
    expect(player.playSound).toHaveBeenCalledTimes(2);
  });
});

describe('AlertService — priority', () => {
  it('a higher-priority type preempts a lower one that is still sounding', () => {
    const player = makeSpyPlayer();
    const clock = makeClock();
    const service = createAlertService({ player, now: clock.now });

    service.handle('noise'); // low priority, now sounding
    clock.advance(100); // still within noise window
    const cry = service.handle('cry');

    expect(cry.event).not.toBeNull();
    // It stopped the lower sound before playing the higher one.
    expect(player.stop).toHaveBeenCalledTimes(1);
    expect(player.playSound).toHaveBeenLastCalledWith(
      soundIdForType('cry'),
      expect.anything(),
    );
  });

  it('drops a lower-priority type while a higher one is still sounding', () => {
    const player = makeSpyPlayer();
    const clock = makeClock();
    const service = createAlertService({ player, now: clock.now });

    service.handle('cry'); // high priority, sounding
    clock.advance(100);
    const noise = service.handle('noise');

    expect(noise.event).toBeNull();
    expect(noise.droppedReason).toBe('priority');
    expect(player.playSound).toHaveBeenCalledTimes(1);
  });

  it('lets a lower-priority type through once the higher one stops sounding', () => {
    const player = makeSpyPlayer();
    const clock = makeClock();
    const service = createAlertService({ player, now: clock.now });

    service.handle('cry'); // cry cooldown/window is 5s
    clock.advance(6000); // past cry window
    const noise = service.handle('noise');

    expect(noise.event).not.toBeNull();
  });
});

describe('AlertService — lifecycle', () => {
  it('tracks lastAlert', () => {
    const player = makeSpyPlayer();
    const service = createAlertService({ player, now: () => 7 });
    expect(service.lastAlert).toBeNull();
    service.handle('motion');
    expect(service.lastAlert?.type).toBe('motion');
  });

  it('stop() stops the player and clears the active channel', () => {
    const player = makeSpyPlayer();
    const clock = makeClock();
    const service = createAlertService({ player, now: clock.now });

    service.handle('cry');
    service.stop();
    expect(player.stop).toHaveBeenCalled();

    // With the channel cleared, a lower-priority alert is no longer blocked
    // (still subject to its own cooldown, which a different type is not).
    clock.advance(100);
    expect(service.handle('noise').event).not.toBeNull();
  });

  it('reset() clears cooldown, priority and lastAlert', () => {
    const player = makeSpyPlayer();
    const clock = makeClock();
    const service = createAlertService({ player, now: clock.now });

    service.handle('noise');
    service.reset();
    expect(service.lastAlert).toBeNull();

    // Same type allowed immediately after reset despite being within cooldown.
    clock.advance(100);
    expect(service.handle('noise').event).not.toBeNull();
  });

  it('defaults to enabled and Date.now when not injected', () => {
    const player = makeSpyPlayer();
    const service = createAlertService({ player });
    expect(service.handle('cry').event).not.toBeNull();
  });
});
