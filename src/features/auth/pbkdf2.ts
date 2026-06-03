/**
 * Dependency-free PBKDF2-HMAC-SHA256 (DMY-44).
 *
 * The parent-mode PIN is low-entropy (4–12 digits). The keychain (Secure
 * Enclave / Keystore, `*_THIS_DEVICE_ONLY`) is the primary defence, but if that
 * blob ever leaks a fast hash is brute-forced instantly. As defence-in-depth we
 * derive the stored PIN hash with a SLOW KDF — PBKDF2-HMAC-SHA256 — so each
 * guess costs `iterations` HMAC rounds.
 *
 * React Native ships no WebCrypto `subtle.deriveBits`, and we deliberately avoid
 * a fragile native crypto dependency (the project already hashes in pure JS, see
 * {@link sha256Hex}). This module is a small, self-contained RFC 2898 / RFC 8018
 * implementation built on a byte-oriented SHA-256 core and an HMAC layer.
 *
 * The bitwise arithmetic is intrinsic to SHA-256; hence the file-level eslint
 * disable for the bitwise/plusplus rules (mirrors {@link sha256.ts}).
 *
 * Privacy: this module is pure arithmetic over byte arrays and never logs.
 */
/* eslint-disable no-bitwise */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_BLOCK_BYTES = 64;
const SHA256_DIGEST_BYTES = 32;

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * SHA-256 over raw bytes, returning the 32-byte digest. Byte-oriented sibling of
 * {@link sha256Hex}; kept separate so the HMAC/PBKDF2 layers operate on
 * `Uint8Array`s without hex round-trips.
 */
export function sha256Bytes(input: Uint8Array): Uint8Array {
  const bitLen = input.length * 8;
  // Padding length: message + 0x80 + zeros to 56 mod 64 + 8-byte length.
  const padded = new Uint8Array(
    Math.ceil((input.length + 9) / SHA256_BLOCK_BYTES) * SHA256_BLOCK_BYTES,
  );
  padded.set(input);
  padded[input.length] = 0x80;
  // 64-bit big-endian length in the final 8 bytes.
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  const lenOffset = padded.length - 8;
  padded[lenOffset] = (hi >>> 24) & 0xff;
  padded[lenOffset + 1] = (hi >>> 16) & 0xff;
  padded[lenOffset + 2] = (hi >>> 8) & 0xff;
  padded[lenOffset + 3] = hi & 0xff;
  padded[lenOffset + 4] = (lo >>> 24) & 0xff;
  padded[lenOffset + 5] = (lo >>> 16) & 0xff;
  padded[lenOffset + 6] = (lo >>> 8) & 0xff;
  padded[lenOffset + 7] = lo & 0xff;

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let chunk = 0; chunk < padded.length; chunk += SHA256_BLOCK_BYTES) {
    for (let i = 0; i < 16; i++) {
      const j = chunk + i * 4;
      w[i] =
        ((padded[j] << 24) |
          (padded[j + 1] << 16) |
          (padded[j + 2] << 8) |
          padded[j + 3]) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(SHA256_DIGEST_BYTES);
  const words = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (words[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (words[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (words[i] >>> 8) & 0xff;
    out[i * 4 + 3] = words[i] & 0xff;
  }
  return out;
}

/**
 * HMAC-SHA256(key, message) -> 32-byte MAC (RFC 2104). Keys longer than the
 * block size are hashed first; shorter keys are zero-padded.
 */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > SHA256_BLOCK_BYTES) {
    k = sha256Bytes(k);
  }
  const block = new Uint8Array(SHA256_BLOCK_BYTES); // zero-padded key
  block.set(k);

  const inner = new Uint8Array(SHA256_BLOCK_BYTES + message.length);
  const outerPre = new Uint8Array(SHA256_BLOCK_BYTES);
  for (let i = 0; i < SHA256_BLOCK_BYTES; i++) {
    inner[i] = block[i] ^ 0x36; // ipad
    outerPre[i] = block[i] ^ 0x5c; // opad
  }
  inner.set(message, SHA256_BLOCK_BYTES);
  const innerHash = sha256Bytes(inner);

  const outer = new Uint8Array(SHA256_BLOCK_BYTES + SHA256_DIGEST_BYTES);
  outer.set(outerPre);
  outer.set(innerHash, SHA256_BLOCK_BYTES);
  return sha256Bytes(outer);
}

/** Encode a JS string to UTF-8 bytes (no TextEncoder dependency under Hermes). */
export function utf8ToBytes(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const hi = code;
      const lo = str.charCodeAt(++i);
      code = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      out.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** Decode a lowercase-hex string into bytes. Throws on odd length / non-hex. */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) {
    throw new Error('pbkdf2: invalid hex input');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Encode bytes as a lowercase-hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * PBKDF2-HMAC-SHA256 (RFC 8018). Derives `keyLenBytes` of key material from a
 * password + salt over `iterations` rounds.
 *
 * Implemented for the single-block case sufficient for our use (`keyLenBytes`
 * <= 32, the HMAC-SHA256 output size) and validated to reject larger requests
 * so a future caller cannot silently get a truncated/incorrect key.
 *
 * @param password   UTF-8 bytes of the secret (the PIN). Held transiently.
 * @param salt       Per-PIN random salt bytes.
 * @param iterations Round count (cost factor). Must be >= 1.
 * @param keyLenBytes Desired derived-key length in bytes (1..32).
 */
export function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keyLenBytes: number,
): Uint8Array {
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('pbkdf2: iterations must be a positive integer');
  }
  if (
    !Number.isInteger(keyLenBytes) ||
    keyLenBytes < 1 ||
    keyLenBytes > SHA256_DIGEST_BYTES
  ) {
    throw new Error('pbkdf2: keyLenBytes must be in 1..32 (single-block)');
  }

  // T_1 = F(password, salt, c, 1). Block index 1 as a 4-byte big-endian suffix.
  const saltWithIndex = new Uint8Array(salt.length + 4);
  saltWithIndex.set(salt);
  saltWithIndex[salt.length] = 0;
  saltWithIndex[salt.length + 1] = 0;
  saltWithIndex[salt.length + 2] = 0;
  saltWithIndex[salt.length + 3] = 1;

  let u = hmacSha256(password, saltWithIndex);
  const t = new Uint8Array(u); // accumulator (XOR of all U_i)
  for (let iter = 1; iter < iterations; iter++) {
    u = hmacSha256(password, u);
    for (let j = 0; j < t.length; j++) {
      t[j] ^= u[j];
    }
  }
  return t.slice(0, keyLenBytes);
}
/* eslint-enable no-bitwise */
