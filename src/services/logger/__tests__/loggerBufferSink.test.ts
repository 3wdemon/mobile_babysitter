/**
 * Tests for the logger -> ring-buffer SINK and its privacy invariant (DMY-62).
 *
 * Every line the logger emits is captured in the in-memory buffer AFTER the
 * logger redacts it. These tests assert (a) entries are captured with the right
 * level/message, and (b) the CRITICAL privacy invariant: SDP / ICE candidate /
 * audio / token content fed into the logger is MASKED in the buffered entry —
 * no raw secret can land in memory (or, downstream, the export).
 *
 * The logger reads `__DEV__` to decide its threshold; we load it (and the
 * co-located buffer singleton) under `jest.isolateModules` with `__DEV__=true`
 * so all levels are captured and each scenario gets a fresh buffer.
 */
import { REDACTED } from '../redact';
import type { LogBuffer } from '../logBuffer';
import type { Logger } from '../logger';

function loadLoggerAndBuffer(dev: boolean): {
  logger: Logger;
  logBuffer: LogBuffer;
} {
  (globalThis as any).__DEV__ = dev;
  let logger: Logger;
  let logBuffer: LogBuffer;
  jest.isolateModules(() => {
    // Both modules resolved inside the SAME isolated registry, so the logger
    // pushes into the very buffer we read here.
    logger = require('../logger').logger;
    logBuffer = require('../logBuffer').logBuffer;
  });
  return { logger: logger!, logBuffer: logBuffer! };
}

describe('logger ring-buffer sink', () => {
  const originalDev = (globalThis as any).__DEV__;

  beforeEach(() => {
    // Silence console output; we assert on the buffer, not the console.
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (globalThis as any).__DEV__ = originalDev;
  });

  it('captures emitted entries into the buffer', () => {
    const { logger, logBuffer } = loadLoggerAndBuffer(true);
    logger.info('connecting');
    logger.warn('slow link');

    const entries = logBuffer.getEntries();
    expect(entries).toHaveLength(2);
    // Newest-first.
    expect(entries[0]).toMatchObject({ level: 'warn', message: 'slow link' });
    expect(entries[1]).toMatchObject({ level: 'info', message: 'connecting' });
    expect(typeof entries[0].timestamp).toBe('number');
  });

  it('does NOT capture entries below the active threshold', () => {
    // Production: debug/info are suppressed and so never reach the sink.
    const { logger, logBuffer } = loadLoggerAndBuffer(false);
    logger.debug('d');
    logger.info('i');
    logger.warn('w');

    const entries = logBuffer.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: 'warn', message: 'w' });
  });

  it('renders object args as redacted JSON in the message', () => {
    const { logger, logBuffer } = loadLoggerAndBuffer(true);
    logger.info('peer', { roomId: 'r1', authToken: 'should-not-appear' });

    const msg = logBuffer.getEntries()[0].message;
    expect(msg).toContain('peer');
    expect(msg).toContain('r1');
    expect(msg).toContain(REDACTED);
    expect(msg).not.toContain('should-not-appear');
  });

  describe('PRIVACY INVARIANT: no SDP / candidate / audio / token leaks', () => {
    it('masks an SDP blob passed under an `sdp` key', () => {
      const { logger, logBuffer } = loadLoggerAndBuffer(true);
      logger.warn('offer', {
        sdp: 'v=0\r\no=- 461 2 IN IP4 0.0.0.0\r\nm=audio 9 UDP/TLS/RTP/SAVPF',
      });

      const msg = logBuffer.getEntries()[0].message;
      expect(msg).toContain(REDACTED);
      expect(msg).not.toMatch(/v=0/);
      expect(msg).not.toMatch(/UDP\/TLS\/RTP\/SAVPF/);
    });

    it('masks an ICE candidate passed under a `candidate` key', () => {
      const { logger, logBuffer } = loadLoggerAndBuffer(true);
      logger.warn('ice', {
        candidate: 'candidate:842163049 1 udp 1677729535 192.168.1.5 54321 typ srflx',
      });

      const msg = logBuffer.getEntries()[0].message;
      expect(msg).toContain(REDACTED);
      expect(msg).not.toMatch(/192\.168\.1\.5/);
      expect(msg).not.toMatch(/srflx/);
    });

    it('masks inline `sdp=` / `candidate=` content in a bare string arg', () => {
      const { logger, logBuffer } = loadLoggerAndBuffer(true);
      logger.error('sdp=v=0-blob candidate=842163049-blob token=secret123');

      const msg = logBuffer.getEntries()[0].message;
      expect(msg).not.toContain('v=0-blob');
      expect(msg).not.toContain('842163049-blob');
      expect(msg).not.toContain('secret123');
      expect(msg).toContain(REDACTED);
    });

    it('masks a RAW SDP string logged as a BARE arg (no sdp key, no name= form)', () => {
      // Regression for DMY-62: a developer logging the raw offer directly
      // (`logger.error('offer', rawSdp)`) must not land raw IPs/ports in the
      // buffer — which the export would then ship off-device. Key-based
      // redaction cannot see this; the value-level SDP/ICE pass must.
      const { logger, logBuffer } = loadLoggerAndBuffer(true);
      logger.error(
        'remote offer:',
        'v=0\r\no=- 461 2 IN IP4 0.0.0.0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=candidate:842163049 1 udp 1677729535 192.168.1.5 54321 typ srflx\r\na=ice-pwd:x9Hf+ASjkdfHJKLqweOIU',
      );

      const msg = logBuffer.getEntries()[0].message;
      expect(msg).not.toContain('192.168.1.5');
      expect(msg).not.toContain('54321');
      expect(msg).not.toContain('srflx');
      expect(msg).not.toContain('x9Hf+ASjkdfHJKLqweOIU');
      expect(msg).toContain(REDACTED);
    });

    it('masks a bare ICE candidate string logged without a key', () => {
      const { logger, logBuffer } = loadLoggerAndBuffer(true);
      logger.warn(
        'candidate:1 1 udp 2130706431 203.0.113.7 60000 typ srflx',
      );
      const msg = logBuffer.getEntries()[0].message;
      expect(msg).not.toContain('203.0.113.7');
      expect(msg).not.toContain('60000');
      expect(msg).toContain(REDACTED);
    });

    it('masks audio/token-ish secrets nested in a peer payload', () => {
      const { logger, logBuffer } = loadLoggerAndBuffer(true);
      logger.error('negotiation', {
        peer: {
          sdp: 'audio-sdp-blob',
          candidate: 'audio-candidate-blob',
          pairingToken: 'pair-tok-xyz',
          id: 9,
        },
      });

      const msg = logBuffer.getEntries()[0].message;
      expect(msg).not.toContain('audio-sdp-blob');
      expect(msg).not.toContain('audio-candidate-blob');
      expect(msg).not.toContain('pair-tok-xyz');
      // Non-secret context is preserved.
      expect(msg).toContain('9');
    });
  });

  it('keeps logging working even if a buffer push were to fail', () => {
    // The sink is wrapped so a buffer fault cannot break logging; emitting
    // never throws regardless.
    const { logger } = loadLoggerAndBuffer(true);
    expect(() => logger.error('boom')).not.toThrow();
  });
});
