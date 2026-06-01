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

  describe('sessionId (exact key, defence-in-depth)', () => {
    it('redacts sessionId / sessionID / session_id', () => {
      const input = {
        sessionId: 'abc-123',
        sessionID: 'def-456',
        session_id: 'ghi-789',
      };
      const result = redact(input) as Record<string, unknown>;
      expect(result.sessionId).toBe(REDACTED);
      expect(result.sessionID).toBe(REDACTED);
      expect(result.session_id).toBe(REDACTED);
      expect(JSON.stringify(result)).not.toContain('abc-123');
      expect(JSON.stringify(result)).not.toContain('def-456');
      expect(JSON.stringify(result)).not.toContain('ghi-789');
    });

    it('matches sessionId variants via isSensitiveKey directly', () => {
      expect(isSensitiveKey('sessionId')).toBe(true);
      expect(isSensitiveKey('sessionID')).toBe(true);
      expect(isSensitiveKey('session_id')).toBe(true);
    });

    it('does NOT over-redact broad session-prefixed diagnostic fields', () => {
      const input = {
        sessionActive: true,
        sessionStartTime: 123,
        session: 'living-room',
      };
      const result = redact(input) as Record<string, unknown>;
      expect(result.sessionActive).toBe(true);
      expect(result.sessionStartTime).toBe(123);
      expect(result.session).toBe('living-room');
    });

    it('keeps bare `session` non-sensitive via isSensitiveKey', () => {
      expect(isSensitiveKey('session')).toBe(false);
      expect(isSensitiveKey('sessionActive')).toBe(false);
      expect(isSensitiveKey('sessionStartTime')).toBe(false);
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

  describe('acronym camelCase boundaries (S3)', () => {
    it('redacts all-caps-acronym + sensitive word', () => {
      const input = {
        APIKey: 'a',
        APIToken: 'b',
        SDPKey: 'c',
        OAuthKey: 'd',
        XToken: 'e',
        roomId: 'r1',
      };
      const result = redact(input) as Record<string, unknown>;
      expect(result.APIKey).toBe(REDACTED);
      expect(result.APIToken).toBe(REDACTED);
      expect(result.SDPKey).toBe(REDACTED);
      expect(result.OAuthKey).toBe(REDACTED);
      expect(result.XToken).toBe(REDACTED);
      expect(result.roomId).toBe('r1');
    });

    it('still rejects substring-only false positives', () => {
      expect(isSensitiveKey('monkey')).toBe(false);
      expect(isSensitiveKey('keyboard')).toBe(false);
      expect(isSensitiveKey('secretary')).toBe(false);
      expect(isSensitiveKey('tokenizer')).toBe(false);
      expect(isSensitiveKey('passwordless')).toBe(false);
      expect(isSensitiveKey('donkey')).toBe(false);
    });

    it('matches APIKey-style acronyms via isSensitiveKey directly', () => {
      expect(isSensitiveKey('APIKey')).toBe(true);
      expect(isSensitiveKey('SDPKey')).toBe(true);
      expect(isSensitiveKey('XToken')).toBe(true);
    });

    it('redacts all-lowercase apikey / apitoken (no camelCase boundary)', () => {
      // These have no separator or camelCase transition, so the word-boundary
      // matcher rejects them (same logic that rejects `monkey`). They are
      // common literal JSON/env spellings, so they are exact-listed instead.
      expect(isSensitiveKey('apikey')).toBe(true);
      expect(isSensitiveKey('apitoken')).toBe(true);

      const result = redact({
        apikey: 'LEAK',
        apitoken: 'LEAK',
        apiKey: 'LEAK',
        APIKey: 'LEAK',
        roomId: 'r1',
      }) as Record<string, unknown>;
      expect(result.apikey).toBe(REDACTED);
      expect(result.apitoken).toBe(REDACTED);
      expect(result.apiKey).toBe(REDACTED);
      expect(result.APIKey).toBe(REDACTED);
      expect(result.roomId).toBe('r1');
      expect(JSON.stringify(result)).not.toContain('LEAK');
    });
  });

  describe('symbol keys (S2)', () => {
    it('redacts a value behind a sensitive symbol key', () => {
      const sym = Symbol('authToken');
      const input: Record<string | symbol, unknown> = { visible: 'ok' };
      input[sym] = 'LEAK';

      const result = redact(input) as Record<string, unknown>;
      expect(result.visible).toBe('ok');
      // Symbol key rendered as String(sym); its value must be redacted.
      expect(result['Symbol(authToken)']).toBe(REDACTED);
      // The raw secret must not appear anywhere in the output.
      expect(JSON.stringify(result)).not.toContain('LEAK');
    });

    it('keeps non-sensitive symbol keys and redacts nested values', () => {
      const sym = Symbol('meta');
      const input: Record<string | symbol, unknown> = {};
      input[sym] = { token: 'x', label: 'ok' };

      const result = redact(input) as Record<string, any>;
      expect(result['Symbol(meta)'].token).toBe(REDACTED);
      expect(result['Symbol(meta)'].label).toBe('ok');
    });

    it('ignores non-enumerable symbol keys', () => {
      const sym = Symbol('authToken');
      const input: Record<string | symbol, unknown> = { visible: 'ok' };
      Object.defineProperty(input, sym, {
        enumerable: false,
        value: 'hidden',
      });
      const result = redact(input) as Record<string, unknown>;
      expect(result.visible).toBe('ok');
      expect(result['Symbol(authToken)']).toBeUndefined();
    });

    it('marks a throwing symbol getter as unreadable', () => {
      const sym = Symbol('plain');
      const input: Record<string | symbol, unknown> = {};
      Object.defineProperty(input, sym, {
        enumerable: true,
        get() {
          throw new Error('nope');
        },
      });
      const result = redact(input) as Record<string, unknown>;
      expect(result['Symbol(plain)']).toBe('[Unreadable]');
    });

    it('handles a symbol with no description', () => {
      const sym = Symbol();
      const input: Record<string | symbol, unknown> = {};
      input[sym] = { ok: 1 };
      const result = redact(input) as Record<string, any>;
      expect(result['Symbol()'].ok).toBe(1);
    });
  });

  describe('Map and Set (S1)', () => {
    it('redacts sensitive entries inside a Map without losing data', () => {
      const map = new Map<string, unknown>([
        ['authToken', 'secret-jwt'],
        ['room', 'living'],
      ]);
      const result = redact(map) as Record<string, unknown>;
      expect(result.authToken).toBe(REDACTED);
      expect(result.room).toBe('living');
      expect(JSON.stringify(result)).not.toContain('secret-jwt');
    });

    it('recursively redacts Map values', () => {
      const map = new Map<string, unknown>([
        ['session', { sdp: 'offer', ok: true }],
      ]);
      const result = redact(map) as Record<string, any>;
      expect(result.session.sdp).toBe(REDACTED);
      expect(result.session.ok).toBe(true);
    });

    it('stringifies non-string Map keys and still redacts their values', () => {
      const map = new Map<unknown, unknown>([
        [1, { token: 'x' }],
        ['plain', 'v'],
      ]);
      const result = redact(map) as Record<string, any>;
      expect(result['1'].token).toBe(REDACTED);
      expect(result.plain).toBe('v');
    });

    it('redacts objects inside a Set', () => {
      const set = new Set<unknown>([
        { token: 'a', priority: 1 },
        'plain',
      ]);
      const result = redact(set) as any[];
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].token).toBe(REDACTED);
      expect(result[0].priority).toBe(1);
      expect(result[1]).toBe('plain');
    });
  });

  describe('value-level redaction (M1)', () => {
    it('redacts a top-level Bearer token', () => {
      expect(redact('Bearer eyJhbGciOiJ.payload.sig')).toBe(
        `Bearer ${REDACTED}`,
      );
    });

    it('redacts key=value secrets in a query string', () => {
      const result = redact(
        'https://x.test/p?room=r1&password=hunter2&token=abc#frag',
      ) as string;
      expect(result).toContain('room=r1');
      expect(result).toContain(`password=${REDACTED}`);
      expect(result).toContain(`token=${REDACTED}`);
      expect(result).not.toContain('hunter2');
      expect(result).not.toContain('abc#frag');
    });

    it('redacts a top-level pairingToken=... string', () => {
      expect(redact('pairingToken=abc123')).toBe(`pairingToken=${REDACTED}`);
    });

    it('redacts inline secrets nested in object string values', () => {
      const result = redact({
        authorization: 'Bearer abc.def.ghi',
        note: 'all good',
      }) as Record<string, unknown>;
      expect(result.authorization).toBe(`Bearer ${REDACTED}`);
      expect(result.note).toBe('all good');
    });

    it('leaves innocuous strings untouched', () => {
      expect(redact('the keyboard is fine')).toBe('the keyboard is fine');
    });
  });

  describe('Error objects (M2)', () => {
    it('preserves name and message instead of collapsing to {}', () => {
      const result = redact(new Error('boom happened')) as Record<
        string,
        unknown
      >;
      expect(result.name).toBe('Error');
      expect(result.message).toBe('boom happened');
      expect(typeof result.stack).toBe('string');
    });

    it('runs value-level redaction over the message and stack', () => {
      const result = redact(new Error('failed token=abc')) as Record<
        string,
        unknown
      >;
      expect(result.message).toBe(`failed token=${REDACTED}`);
      expect(JSON.stringify(result)).not.toContain('token=abc');
    });

    it('does not duplicate name/message/stack when they are own-enumerable', () => {
      const err = new Error('msg');
      // Force an own enumerable 'message' to exercise the skip branch.
      Object.defineProperty(err, 'message', {
        enumerable: true,
        value: 'msg',
        configurable: true,
      });
      const result = redact(err) as Record<string, unknown>;
      expect(result.message).toBe('msg');
      expect(result.name).toBe('Error');
    });

    it('redacts custom enumerable properties on an Error', () => {
      const err = new Error('x') as Error & { authToken?: string };
      err.authToken = 'leak';
      const result = redact(err) as Record<string, unknown>;
      expect(result.authToken).toBe(REDACTED);
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
