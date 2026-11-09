// Small byte helpers shared by the CLI (Node) and the browser page.
// No dependencies; works anywhere TextEncoder and Uint8Array exist.

const encoder = new TextEncoder();

export const utf8 = (s) => encoder.encode(s);

export function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function u32be(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError(`u32 out of range: ${n}`);
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

export function u64be(n) {
  const v = typeof n === 'bigint' ? n : BigInt(n);
  if (v < 0n || v > 0xffffffffffffffffn) throw new RangeError(`u64 out of range: ${n}`);
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, false);
  return b;
}

/** Length-prefixed UTF-8 string: u32 big-endian length, then the bytes. */
export function varbytes(s) {
  const b = utf8(s);
  return concat(u32be(b.length), b);
}

const HEX = '0123456789abcdef';

export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += HEX[b >> 4] + HEX[b & 15];
  return s;
}

export function fromHex(hex, expectedLength) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new TypeError('not a hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  if (expectedLength !== undefined && out.length !== expectedLength) {
    throw new TypeError(`expected ${expectedLength} bytes, got ${out.length}`);
  }
  return out;
}

export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
