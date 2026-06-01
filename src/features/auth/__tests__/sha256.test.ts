import { sha256Hex } from '../sha256';

/**
 * Known-answer tests against the FIPS-180-4 / NIST reference vectors. These pin
 * the hash to the standard so a refactor cannot silently change the digest (and
 * thereby invalidate every stored PIN).
 */
describe('sha256Hex', () => {
  it('hashes the empty string', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the 56-byte multi-block NIST vector', () => {
    expect(
      sha256Hex(
        'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      ),
    ).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles multi-byte UTF-8 input', () => {
    // Stable, non-empty 64-hex-char output; exercises the UTF-8 encoder path.
    const out = sha256Hex('café — 🍼');
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(sha256Hex('1234')).toBe(sha256Hex('1234'));
  });

  it('is sensitive to small input changes (avalanche)', () => {
    expect(sha256Hex('1234')).not.toBe(sha256Hex('1235'));
  });
});
