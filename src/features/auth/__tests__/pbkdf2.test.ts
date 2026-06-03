import {
  bytesToHex,
  hexToBytes,
  hmacSha256,
  pbkdf2Sha256,
  sha256Bytes,
  utf8ToBytes,
} from '../pbkdf2';

describe('pbkdf2 building blocks', () => {
  describe('sha256Bytes', () => {
    it('matches the known digest of the empty string', () => {
      expect(bytesToHex(sha256Bytes(new Uint8Array(0)))).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
    });

    it('matches the known digest of "abc"', () => {
      expect(bytesToHex(sha256Bytes(utf8ToBytes('abc')))).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });
  });

  describe('hmacSha256 (RFC 4231 vectors)', () => {
    it('Test Case 1: key=0x0b*20, data="Hi There"', () => {
      const key = hexToBytes('0b'.repeat(20));
      const data = utf8ToBytes('Hi There');
      expect(bytesToHex(hmacSha256(key, data))).toBe(
        'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
      );
    });

    it('Test Case 2: key="Jefe", data="what do ya want for nothing?"', () => {
      const key = utf8ToBytes('Jefe');
      const data = utf8ToBytes('what do ya want for nothing?');
      expect(bytesToHex(hmacSha256(key, data))).toBe(
        '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
      );
    });

    it('handles a key longer than the block size (hashed first)', () => {
      // Test Case 4 key (0xaa * 131) -> data "Test Using Larger Than Block-Size Key".
      const key = hexToBytes('aa'.repeat(131));
      const data = utf8ToBytes(
        'Test Using Larger Than Block-Size Key - Hash Key First',
      );
      expect(bytesToHex(hmacSha256(key, data))).toBe(
        '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
      );
    });
  });

  describe('pbkdf2Sha256 (RFC 7914 / known vectors)', () => {
    it('matches the c=1 vector', () => {
      const dk = pbkdf2Sha256(
        utf8ToBytes('passwd'),
        utf8ToBytes('salt'),
        1,
        16,
      );
      // Reference: first 16 bytes of PBKDF2-HMAC-SHA256("passwd","salt",1,...).
      expect(bytesToHex(dk)).toBe('55ac046e56e3089fec1691c22544b605');
    });

    it('matches the c=80000 vector', () => {
      const dk = pbkdf2Sha256(
        utf8ToBytes('Password'),
        utf8ToBytes('NaCl'),
        80000,
        16,
      );
      expect(bytesToHex(dk)).toBe('4ddcd8f60b98be21830cee5ef22701f9');
    });

    it('is deterministic for the same inputs', () => {
      const a = pbkdf2Sha256(utf8ToBytes('1234'), hexToBytes('ab12'), 1000, 32);
      const b = pbkdf2Sha256(utf8ToBytes('1234'), hexToBytes('ab12'), 1000, 32);
      expect(bytesToHex(a)).toBe(bytesToHex(b));
    });

    it('differs with a different salt (same PIN)', () => {
      const a = pbkdf2Sha256(utf8ToBytes('1234'), hexToBytes('aa'), 1000, 32);
      const b = pbkdf2Sha256(utf8ToBytes('1234'), hexToBytes('bb'), 1000, 32);
      expect(bytesToHex(a)).not.toBe(bytesToHex(b));
    });

    it('differs with a different PIN (same salt)', () => {
      const a = pbkdf2Sha256(utf8ToBytes('1234'), hexToBytes('aa'), 1000, 32);
      const b = pbkdf2Sha256(utf8ToBytes('5678'), hexToBytes('aa'), 1000, 32);
      expect(bytesToHex(a)).not.toBe(bytesToHex(b));
    });

    it('rejects invalid iterations / key length', () => {
      expect(() =>
        pbkdf2Sha256(utf8ToBytes('x'), utf8ToBytes('s'), 0, 16),
      ).toThrow(/iterations/);
      expect(() =>
        pbkdf2Sha256(utf8ToBytes('x'), utf8ToBytes('s'), 1, 0),
      ).toThrow(/keyLenBytes/);
      expect(() =>
        pbkdf2Sha256(utf8ToBytes('x'), utf8ToBytes('s'), 1, 64),
      ).toThrow(/keyLenBytes/);
    });
  });

  describe('hex / utf8 helpers', () => {
    it('round-trips bytes <-> hex', () => {
      const bytes = Uint8Array.from([0, 1, 15, 16, 255, 128]);
      expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
    });

    it('rejects odd-length / non-hex input', () => {
      expect(() => hexToBytes('abc')).toThrow();
      expect(() => hexToBytes('zz')).toThrow();
    });

    it('encodes multi-byte UTF-8 (no PIN material here, just correctness)', () => {
      // "é" -> 0xC3 0xA9; ensures the encoder is correct for the hmac key path.
      expect(bytesToHex(utf8ToBytes('é'))).toBe('c3a9');
    });
  });
});
