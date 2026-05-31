import { redact, isSensitiveKey, REDACTED } from '../redact';

describe('redact', () => {
  describe('sensitive keys (exact)', () => {
    it('redacts pairingToken, sdp, authToken and keeps other fields intact', () => {
      const input = {
        pairingToken: 'abc123',
        sdp: 'v=0\r\no=- 12345',
        authToken: 'bearer-xyz',
        roomId: 'living-room',
        connected: true,
      };

      const result = redact(input) as Record<string, unknown>;

      expect(result.pairingToken).toBe(REDACTED);
      expect(result.sdp).toBe(REDACTED);
      expect(result.authToken).toBe(REDACTED);
      // Non-sensitive fields untouched.
      expect(result.roomId).toBe('living-room');
      expect(result.connected).toBe(true);
    });

    it('redacts the full built-in exact key list (case-insensitive)', () => {
      const input = {
        PairingToken: 'a',
        SDP: 'b',
        Candidate: 'c',
        AuthToken: 'd',
        Token: 'e',
        Password: 'f',
        Secret: 'g',
        Email: 'h',
        Key: 'i',
        Biometric: 'j',
      };

      const result = redact(input) as Record<string, unknown>;
      for (const value of Object.values(result)) {
        expect(value).toBe(REDACTED);
      }
    });

    it('supports additional exact keys via options', () => {
      const result = redact(
        { ssn: '123-45-6789', name: 'baby' },
        { additionalKeys: ['ssn'] },
      ) as Record<string, unknown>;

      expect(result.ssn).toBe(REDACTED);
      expect(result.name).toBe('baby');
    });

    it('honours a custom placeholder', () => {
      const result = redact({ token: 'x' }, { placeholder: '***' }) as Record<
        string,
        unknown
      >;
      expect(result.token).toBe('***');
    });
  });

  describe('pattern keys', () => {
    it('redacts camelCase / snake_case / kebab variants', () => {
      const input = {
        accessToken: 'a',
        api_secret: 'b',
        'secret-value': 'c',
        userPassword: 'd',
        publicKey: 'e',
      };

      const result = redact(input) as Record<string, unknown>;
      expect(result.accessToken).toBe(REDACTED);
      expect(result.api_secret).toBe(REDACTED);
      expect(result['secret-value']).toBe(REDACTED);
      expect(result.userPassword).toBe(REDACTED);
      expect(result.publicKey).toBe(REDACTED);
    });
  });

  describe('false positives (boundary cases)', () => {
    it('does NOT redact innocuous keys that merely contain a sensitive substring', () => {
      const input = {
        monkey: 'george',
        donkey: 'kong',
        keyboard: 'qwerty',
        tokenizer: 'bpe',
        passwordless: true,
        secretary: 'jane',
      };

      const result = redact(input) as Record<string, unknown>;
      expect(result.monkey).toBe('george');
      expect(result.donkey).toBe('kong');
      expect(result.keyboard).toBe('qwerty');
      expect(result.tokenizer).toBe('bpe');
      expect(result.passwordless).toBe(true);
      expect(result.secretary).toBe('jane');
    });
  });

  describe('recursion', () => {
    it('redacts nested objects', () => {
      const input = {
        session: {
          peer: {
            sdp: 'offer',
            label: 'ok',
          },
        },
      };

      const result = redact(input) as any;
      expect(result.session.peer.sdp).toBe(REDACTED);
      expect(result.session.peer.label).toBe('ok');
    });

    it('redacts sensitive values inside arrays of objects', () => {
      const input = {
        candidates: [
          { candidate: 'a', priority: 1 },
          { candidate: 'b', priority: 2 },
        ],
      };

      const result = redact(input) as any;
      expect(result.candidates[0].candidate).toBe(REDACTED);
      expect(result.candidates[0].priority).toBe(1);
      expect(result.candidates[1].candidate).toBe(REDACTED);
      expect(result.candidates[1].priority).toBe(2);
    });

    it('preserves array length and primitive elements', () => {
      const result = redact([1, 'two', null, { token: 'x', y: 2 }]) as any[];
      expect(result).toHaveLength(4);
      expect(result[0]).toBe(1);
      expect(result[1]).toBe('two');
      expect(result[2]).toBeNull();
      expect(result[3].token).toBe(REDACTED);
      expect(result[3].y).toBe(2);
    });

    it('caps recursion at maxDepth', () => {
      const result = redact({ a: { b: { c: { d: 1 } } } }, { maxDepth: 1 }) as any;
      expect(result.a.b).toBe('[Object]');
    });
  });

  describe('primitives and edge inputs', () => {
    it.each([
      ['string', 'hello', 'hello'],
      ['number', 42, 42],
      ['boolean', true, true],
      ['null', null, null],
      ['undefined', undefined, undefined],
    ])('returns %s unchanged', (_label, value, expected) => {
      expect(redact(value)).toBe(expected);
    });

    it('replaces functions with a marker', () => {
      const result = redact({ cb: () => 1, x: 2 }) as Record<string, unknown>;
      expect(result.cb).toBe('[Function]');
      expect(result.x).toBe(2);
    });

    it('handles circular references without throwing', () => {
      const obj: any = { name: 'a', token: 'secret' };
      obj.self = obj;

      let result: any;
      expect(() => {
        result = redact(obj);
      }).not.toThrow();
      expect(result.name).toBe('a');
      expect(result.token).toBe(REDACTED);
      expect(result.self).toBe('[Circular]');
    });

    it('does not mutate the original input', () => {
      const input = { token: 'secret', nested: { sdp: 'x' } };
      redact(input);
      expect(input.token).toBe('secret');
      expect(input.nested.sdp).toBe('x');
    });

    it('serialises Date and RegExp deterministically', () => {
      const d = new Date('2026-01-01T00:00:00.000Z');
      const result = redact({ at: d, re: /ab+c/g }) as Record<string, unknown>;
      expect(result.at).toBe('2026-01-01T00:00:00.000Z');
      expect(result.re).toBe('/ab+c/g');
    });

    it('keeps the key but marks unreadable getters', () => {
      const input = {};
      Object.defineProperty(input, 'boom', {
        enumerable: true,
        get() {
          throw new Error('nope');
        },
      });
      const result = redact(input) as Record<string, unknown>;
      expect(result.boom).toBe('[Unreadable]');
    });
  });

  describe('isSensitiveKey', () => {
    it('matches exact keys case-insensitively', () => {
      expect(isSensitiveKey('SDP')).toBe(true);
      expect(isSensitiveKey('email')).toBe(true);
    });
    it('rejects substring-only matches', () => {
      expect(isSensitiveKey('monkey')).toBe(false);
      expect(isSensitiveKey('keyboard')).toBe(false);
    });
  });
});
