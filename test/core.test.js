import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes as nodeRandom } from 'node:crypto';
import { sha256, makeRng } from '../src/core/hash.js';
import { toHex, fromHex, utf8 } from '../src/core/bytes.js';
import { encodeLeafPreimage, leafHash, normalizeLine, ValidationError, formatAmount, dummyLeafHash } from '../src/core/encoding.js';
import { buildTree, proofFor, rootFromProof, nodeHash } from '../src/core/merkle.js';

const ctx = { employer: 'acme-payroll.test.near', run_id: '2026-10' };
const line = {
  employee_account: 'ada-lagos.testnet', amount_cents: 580000, currency: 'USD', period: '2026-10',
  department: 'Engineering', payout_pref: { chain: 'base', asset: 'USDC' },
};
const salt = new Uint8Array(32).fill(7);

test('sha256 wrapper agrees with node:crypto', async () => {
  for (const len of [0, 1, 55, 56, 64, 1000]) {
    const data = nodeRandom(len);
    assert.equal(toHex(await sha256(data)), createHash('sha256').update(data).digest('hex'));
  }
});

test('leaf hash known answer (also reproduced by an independent Python script, see docs/SPEC.md)', async () => {
  assert.equal(
    toHex(await leafHash(ctx, line, salt)),
    '8d67b8dd60d25c9394f7f26d4b7a9b2d22f3372dc635408017b0680cfd27dec9',
  );
});

test('leaf preimage starts with the domain label and ends with the salt', () => {
  const pre = encodeLeafPreimage(ctx, line, salt);
  assert.equal(new TextDecoder().decode(pre.slice(0, 12)), 'PSP/v1/leaf\0');
  assert.deepEqual([...pre.slice(-32)], [...salt]);
});

test('every committed field changes the leaf hash', async () => {
  const base = toHex(await leafHash(ctx, line, salt));
  const variants = [
    [ctx, { ...line, amount_cents: 580001 }],
    [ctx, { ...line, employee_account: 'ada-lagos.testne' }],
    [ctx, { ...line, period: '2026-11' }],
    [ctx, { ...line, currency: 'EUR' }],
    [ctx, { ...line, department: 'Design' }],
    [ctx, { ...line, payout_pref: { chain: 'eth', asset: 'USDC' } }],
    [ctx, { ...line, payout_pref: { chain: 'base', asset: 'ETH' } }],
    [{ ...ctx, employer: 'evil-payroll.test.near' }, line],
    [{ ...ctx, run_id: '2026-11' }, line],
  ];
  for (const [c, l] of variants) assert.notEqual(toHex(await leafHash(c, l, salt)), base);
  assert.notEqual(toHex(await leafHash(ctx, line, new Uint8Array(32).fill(8))), base);
});

test('length prefixes stop field-boundary tricks', async () => {
  // "ab"+"c" must not collide with "a"+"bc"
  const a = await leafHash({ employer: 'ab.near', run_id: 'c' }, line, salt);
  const b = await leafHash({ employer: 'a.near', run_id: 'bc' }, line, salt);
  assert.notEqual(toHex(a), toHex(b));
});

test('dummy leaves use their own domain', async () => {
  const seed = new Uint8Array(32).fill(1);
  assert.notEqual(toHex(await dummyLeafHash(seed)), toHex(await sha256(seed)));
});

test('validation rejects malformed lines', () => {
  const bad = [
    { ...line, amount_cents: 0 },
    { ...line, amount_cents: -5 },
    { ...line, amount_cents: 12.5 },
    { ...line, amount_cents: '100' },
    { ...line, amount_cents: 2 ** 53 },
    { ...line, employee_account: 'Ada.Lagos' },
    { ...line, employee_account: 'a' },
    { ...line, currency: 'usd' },
    { ...line, period: '2026-13' },
    { ...line, period: '2026-1' },
    { ...line, department: 'x'.repeat(41) },
    { ...line, department: 'Enǵineering' },
    { ...line, payout_pref: { chain: 'Base', asset: 'USDC' } },
    { ...line, payout_pref: { chain: 'base' } },
    { ...line, extra: 1 },
    { ...line, payout_pref: { chain: 'base', asset: 'USDC', address: '0x1' } },
  ];
  for (const l of bad) assert.throws(() => normalizeLine(l), ValidationError, JSON.stringify(l));
  assert.equal(normalizeLine(line).department, 'Engineering');
  assert.equal(normalizeLine({ ...line, department: undefined }).department, '');
});

test('formatAmount', () => {
  assert.equal(formatAmount(580000), '5,800.00');
  assert.equal(formatAmount(5), '0.05');
  assert.equal(formatAmount(123456789), '1,234,567.89');
});

test('merkle: every leaf proves in trees of 1..33 leaves, odd nodes are promoted', async () => {
  for (let n = 1; n <= 33; n++) {
    const leaves = [];
    for (let i = 0; i < n; i++) leaves.push(await sha256(utf8(`leaf-${i}`)));
    const { levels, root } = await buildTree(leaves);
    for (let i = 0; i < n; i++) {
      const proof = proofFor(levels, i);
      assert.equal(toHex(await rootFromProof(leaves[i], proof)), toHex(root), `n=${n} i=${i}`);
      assert.deepEqual(Object.keys(proof[0] ?? { side: 0, hash: 0 }).sort(), ['hash', 'side']);
    }
  }
});

test('merkle: 3-leaf tree promotes the odd leaf unchanged (no duplication)', async () => {
  const [a, b, c] = [await sha256(utf8('a')), await sha256(utf8('b')), await sha256(utf8('c'))];
  const { root } = await buildTree([a, b, c]);
  assert.equal(toHex(root), toHex(await nodeHash(await nodeHash(a, b), c)));
  // and it differs from the tree where c is duplicated
  assert.notEqual(toHex(root), toHex((await buildTree([a, b, c, c])).root));
});

test('merkle: a wrong sibling, wrong side or extra step breaks the root', async () => {
  const leaves = [];
  for (let i = 0; i < 8; i++) leaves.push(await sha256(utf8(`x${i}`)));
  const { levels, root } = await buildTree(leaves);
  const proof = proofFor(levels, 3);
  const good = toHex(root);
  const flipped = proof.map((s, i) => (i === 1 ? { ...s, side: s.side === 'left' ? 'right' : 'left' } : s));
  assert.notEqual(toHex(await rootFromProof(leaves[3], flipped)), good);
  const wrongHash = proof.map((s, i) => (i === 0 ? { ...s, hash: '00'.repeat(32) } : s));
  assert.notEqual(toHex(await rootFromProof(leaves[3], wrongHash)), good);
  assert.notEqual(toHex(await rootFromProof(leaves[3], [...proof, proof[0]])), good);
  await assert.rejects(() => rootFromProof(leaves[3], [{ side: 'up', hash: '00'.repeat(32) }]));
});

test('leaf and node hashes are domain separated (an inner node cannot pass as a leaf)', async () => {
  const [a, b] = [await sha256(utf8('a')), await sha256(utf8('b'))];
  const inner = await nodeHash(a, b);
  const { root } = await buildTree([a, b]);
  // Presenting `inner` as a leaf with an empty proof reaches `root` only because inner IS the root.
  // A line-shaped leaf must hash with the leaf label, so no line can ever equal an inner node:
  assert.equal(toHex(inner), toHex(root));
  assert.notEqual(toHex(await leafHash(ctx, line, salt)), toHex(inner));
});

test('rng: seeded stream is reproducible, unseeded is not', async () => {
  const a = makeRng('s'); const b = makeRng('s'); const c = makeRng();
  assert.equal(toHex(await a.bytes(40)), toHex(await b.bytes(40)));
  assert.notEqual(toHex(await makeRng().bytes(32)), toHex(await c.bytes(32)));
  assert.equal(a.deterministic, true);
  assert.equal(c.deterministic, false);
  const ints = new Set();
  for (let i = 0; i < 200; i++) ints.add(await a.int(5));
  assert.deepEqual([...ints].sort(), [0, 1, 2, 3, 4]);
});

test('hex helpers are strict', () => {
  assert.throws(() => fromHex('zz'));
  assert.throws(() => fromHex('abc'));
  assert.throws(() => fromHex('aa', 2));
});
