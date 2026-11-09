// SHA-256 through WebCrypto. The same call works in Node 22 and in browsers
// (browsers expose crypto.subtle only on https:// or localhost).
import { concat } from './bytes.js';

export async function sha256(...parts) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', concat(...parts));
  return new Uint8Array(digest);
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/**
 * Randomness source. With no seed it is the operating system CSPRNG.
 * With a seed it is a deterministic SHA-256 counter stream, which exists ONLY so the
 * public sample and the tests reproduce the same Merkle root every time.
 * A payroll built with a seed is only as private as the seed is secret.
 */
export function makeRng(seed) {
  if (seed === undefined || seed === null || seed === '') {
    return { deterministic: false, bytes: async (n) => randomBytes(n), int: async (max) => randomInt(max) };
  }
  const seedBytes = new TextEncoder().encode(String(seed));
  const label = new TextEncoder().encode('PSP/v1/drbg\0');
  let counter = 0n;
  let buffer = new Uint8Array(0);
  const bytes = async (n) => {
    while (buffer.length < n) {
      const c = new Uint8Array(8);
      new DataView(c.buffer).setBigUint64(0, counter++, false);
      buffer = concat(buffer, await sha256(label, seedBytes, c));
    }
    const out = buffer.slice(0, n);
    buffer = buffer.slice(n);
    return out;
  };
  const int = async (max) => {
    // Rejection sampling over 32-bit words: uniform in [0, max).
    const limit = Math.floor(0x100000000 / max) * max;
    for (;;) {
      const w = new DataView((await bytes(4)).buffer).getUint32(0, false);
      if (w < limit) return w % max;
    }
  };
  return { deterministic: true, bytes, int };
}

function randomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}
