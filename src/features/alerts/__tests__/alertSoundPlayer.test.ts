/**
 * Unit tests for the no-op alert sound player (DMY-26).
 *
 * The shipped default must satisfy the contract, never throw, and leak no audio
 * — only a sound id may appear in logs. Real playback is DMY-9.
 */
import { logger } from '../../../services/logger';
import {
  createNoopAlertSoundPlayer,
  noopAlertSoundPlayer,
} from '../alertSoundPlayer';

describe('noopAlertSoundPlayer', () => {
  it('does not throw on playSound or stop', () => {
    expect(() => noopAlertSoundPlayer.playSound('alert-cry')).not.toThrow();
    expect(() => noopAlertSoundPlayer.playSound('alert-cry', 0.5)).not.toThrow();
    expect(() => noopAlertSoundPlayer.stop()).not.toThrow();
  });

  it('factory returns a usable no-op player', () => {
    const player = createNoopAlertSoundPlayer();
    expect(() => player.playSound('alert-noise')).not.toThrow();
    expect(() => player.stop()).not.toThrow();
  });

  it('logs only the sound id / volume, never audio', () => {
    const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
    try {
      noopAlertSoundPlayer.playSound('alert-motion', 0.7);
      expect(debugSpy).toHaveBeenCalled();
      for (const call of debugSpy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toMatch(/audio|buffer|pcm|samples|wav|mp3|caf/i);
      }
    } finally {
      debugSpy.mockRestore();
    }
  });
});
