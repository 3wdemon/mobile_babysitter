import { REDACTED } from '../redact';

/**
 * The logger reads the global `__DEV__` flag to decide its threshold.
 * We re-require the module under jest.isolateModules after setting the global
 * so each scenario gets a fresh evaluation.
 */
function loadLogger(dev: boolean) {
  (globalThis as any).__DEV__ = dev;
  let mod: typeof import('../logger');
  jest.isolateModules(() => {
    mod = require('../logger');
  });
  return mod!.logger;
}

describe('logger', () => {
  let spies: Record<'log' | 'info' | 'warn' | 'error', jest.SpyInstance>;
  const originalDev = (globalThis as any).__DEV__;

  beforeEach(() => {
    spies = {
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (globalThis as any).__DEV__ = originalDev;
  });

  describe('development (__DEV__ === true)', () => {
    it('emits all levels', () => {
      const logger = loadLogger(true);
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');

      expect(spies.log).toHaveBeenCalledTimes(1);
      expect(spies.info).toHaveBeenCalledTimes(1);
      expect(spies.warn).toHaveBeenCalledTimes(1);
      expect(spies.error).toHaveBeenCalledTimes(1);
    });

    it('prefixes the level tag', () => {
      const logger = loadLogger(true);
      logger.warn('hello');
      expect(spies.warn).toHaveBeenCalledWith('[WARN]', 'hello');
    });
  });

  describe('production (__DEV__ === false)', () => {
    it('silences debug and info', () => {
      const logger = loadLogger(false);
      logger.debug('d');
      logger.info('i');
      expect(spies.log).not.toHaveBeenCalled();
      expect(spies.info).not.toHaveBeenCalled();
    });

    it('still emits warn and error', () => {
      const logger = loadLogger(false);
      logger.warn('w');
      logger.error('e');
      expect(spies.warn).toHaveBeenCalledTimes(1);
      expect(spies.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('redaction integration', () => {
    it('redacts sensitive fields before writing to console', () => {
      const logger = loadLogger(true);
      logger.info('connecting', { pairingToken: 'tok', roomId: 'r1' });

      expect(spies.info).toHaveBeenCalledWith('[INFO]', 'connecting', {
        pairingToken: REDACTED,
        roomId: 'r1',
      });
    });

    it('redacts nested SDP inside arguments', () => {
      const logger = loadLogger(true);
      logger.error('offer failed', { peer: { sdp: 'v=0', id: 7 } });

      expect(spies.error).toHaveBeenCalledWith('[ERROR]', 'offer failed', {
        peer: { sdp: REDACTED, id: 7 },
      });
    });

    it('logs Error name/message instead of an empty object', () => {
      const logger = loadLogger(true);
      logger.error(new Error('connect failed token=abc'));

      const call = spies.error.mock.calls[0];
      expect(call[0]).toBe('[ERROR]');
      const payload = call[1] as Record<string, unknown>;
      expect(payload.name).toBe('Error');
      expect(payload.message).toBe(`connect failed token=${REDACTED}`);
      expect(typeof payload.stack).toBe('string');
    });
  });

  describe('robustness', () => {
    it('does not throw on circular argument', () => {
      const logger = loadLogger(true);
      const circular: any = { token: 'x' };
      circular.self = circular;
      expect(() => logger.info(circular)).not.toThrow();
    });

    it.each([[null], [undefined], [42], ['str'], [false]])(
      'does not throw on primitive argument %p',
      primitive => {
        const logger = loadLogger(true);
        expect(() => logger.warn(primitive)).not.toThrow();
      },
    );

    it('does not throw when console method itself throws', () => {
      const logger = loadLogger(true);
      spies.error.mockImplementation(() => {
        throw new Error('console down');
      });
      expect(() => logger.error('boom')).not.toThrow();
    });
  });

  describe('default environment (no __DEV__)', () => {
    it('treats missing __DEV__ as production (warn+ only)', () => {
      (globalThis as any).__DEV__ = undefined;
      let logger: typeof import('../logger').logger;
      jest.isolateModules(() => {
        logger = require('../logger').logger;
      });
      logger!.debug('d');
      logger!.warn('w');
      expect(spies.log).not.toHaveBeenCalled();
      expect(spies.warn).toHaveBeenCalledTimes(1);
    });
  });
});
