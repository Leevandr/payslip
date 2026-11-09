import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPayslip, verifyDisclosure } from '../src/core/verify.js';
import { exportDisclosure, selectorFrom, exportPayslips, commitmentOf, buildRun } from '../src/core/run.js';
import { makeRng } from '../src/core/hash.js';
import { sampleSetup, sampleInput, recordFor, clone, NETWORK } from './helpers.js';

const ada = (s) => s.payslips.find((p) => p.line.employee_account === 'ada-lagos.testnet');

test('happy path: every payslip verifies and prints the contract-specified summary line', async () => {
  const s = await sampleSetup();
  for (const p of s.payslips) assert.equal((await verifyPayslip(p, s.record)).ok, true, p.line.employee_account);
  const r = await verifyPayslip(ada(s), s.record);
  assert.equal(r.summary, 'VERIFIED: 5,800.00 USD for 2026-10, paid by acme-payroll.test.near');
});

// ---------------------------------------------------------------- tamper tests
test('tamper: changed amount', async () => {
  const s = await sampleSetup();
  const p = clone(ada(s)); p.line.amount_cents = 980000;
  const r = await verifyPayslip(p, s.record);
  assert.equal(r.ok, false);
  assert.match(r.failure.text, /does not equal the committed root/);
});

test('tamper: changed salt, department, payout preference, account, period', async () => {
  const s = await sampleSetup();
  const edits = [
    (p) => { p.salt = '00'.repeat(32); },
    (p) => { p.line.department = 'Design'; },
    (p) => { p.line.payout_pref.chain = 'eth'; },
    (p) => { p.line.employee_account = 'mallory.testnet'; },
    (p) => { p.line.period = '2026-09'; },
  ];
  for (const edit of edits) {
    const p = clone(ada(s)); edit(p);
    assert.equal((await verifyPayslip(p, s.record)).ok, false);
  }
});

test('tamper: wrong sibling hash, flipped side, dropped step, extra step', async () => {
  const s = await sampleSetup();
  const mk = (f) => { const p = clone(ada(s)); f(p); return p; };
  const cases = [
    mk((p) => { p.proof[1].hash = 'ab'.repeat(32); }),
    mk((p) => { p.proof[2].side = p.proof[2].side === 'left' ? 'right' : 'left'; }),
    mk((p) => { p.proof.pop(); }),
    mk((p) => { p.proof.push(p.proof[0]); }),
    mk((p) => { p.proof = []; }),
  ];
  for (const p of cases) assert.equal((await verifyPayslip(p, s.record)).ok, false);
});

test('tamper: wrong employer named in the payslip', async () => {
  const s = await sampleSetup();
  const p = clone(ada(s)); p.employer = 'other-payroll.test.near';
  // the chain has no commitment under that name
  const none = await verifyPayslip(p, null);
  assert.equal(none.ok, false);
  assert.match(none.failure.text, /no commitment found/);
  // even if a record existed under that name with the same root, the employer is inside the leaf
  const record = recordFor(s.run, { employer: 'other-payroll.test.near' });
  const r = await verifyPayslip(p, record);
  assert.equal(r.ok, false);
  assert.match(r.failure.text, /does not equal the committed root/);
});

test('tamper: copy-root attack (an impostor commits the same root under their own account)', async () => {
  const s = await sampleSetup();
  const impostor = recordFor(s.run, { employer: 'mallory-payroll.testnet' });
  // she presents the genuine payslip but renames the employer to herself
  const p = clone(ada(s)); p.employer = 'mallory-payroll.testnet';
  assert.equal((await verifyPayslip(p, impostor)).ok, false);
  // and if she leaves the employer alone, the chain record does not belong to that employer
  const q = clone(ada(s));
  const r = await verifyPayslip(q, impostor);
  assert.equal(r.ok, false);
  assert.match(r.failure.text, /different employer or run/);
});

test('tamper: wrong run_id and no commitment at all', async () => {
  const s = await sampleSetup();
  const p = clone(ada(s)); p.run_id = '2026-11';
  assert.equal((await verifyPayslip(p, null)).ok, false);
  assert.equal((await verifyPayslip(ada(s), null)).ok, false);
  assert.equal((await verifyPayslip(p, s.record)).ok, false);
});

test('tamper: revoked run', async () => {
  const s = await sampleSetup();
  const record = recordFor(s.run, { revoked: true, revoked_at_ms: 1790100000000 });
  const r = await verifyPayslip(ada(s), record);
  assert.equal(r.ok, false);
  assert.match(r.failure.text, /REVOKED/);
});

test('tamper: committed root or bucket differs from the proof', async () => {
  const s = await sampleSetup();
  assert.equal((await verifyPayslip(ada(s), recordFor(s.run, { root: 'cd'.repeat(32) }))).ok, false);
  const r = await verifyPayslip(ada(s), recordFor(s.run, { headcount_bucket: 32 }));
  assert.equal(r.ok, false);
  assert.match(r.failure.text, /needs 5/);
  assert.equal((await verifyPayslip(ada(s), recordFor(s.run, { period: '2026-09' }))).ok, false);
  assert.equal((await verifyPayslip(ada(s), recordFor(s.run, { currency: 'EUR' }))).ok, false);
});

test('malformed payslips fail cleanly, never throw', async () => {
  const s = await sampleSetup();
  const bad = [null, {}, { format: 'x' }, { ...clone(ada(s)), salt: 'zz' }, { ...clone(ada(s)), proof: 'no' },
    { ...clone(ada(s)), line: { ...ada(s).line, extra: 1 } }, { ...clone(ada(s)), proof: [{ side: 'up', hash: '00' }] }];
  for (const p of bad) assert.equal((await verifyPayslip(p, s.record)).ok, false);
});

// ---------------------------------------------------------------- privacy properties
test('privacy: a payslip carries nothing about anyone else', async () => {
  const s = await sampleSetup();
  const text = JSON.stringify(ada(s));
  for (const other of s.run.leaves.filter((l) => l.kind === 'line' && l.line.employee_account !== 'ada-lagos.testnet')) {
    assert.ok(!text.includes(other.line.employee_account), `leaks ${other.line.employee_account}`);
    assert.ok(!text.includes(other.salt), 'leaks a salt');
    assert.ok(!text.includes(String(other.line.amount_cents)), `leaks ${other.line.amount_cents}`);
  }
  // only these keys, and proof steps carry only a side and a hash (no sums, no counts)
  assert.deepEqual(Object.keys(ada(s)).sort(), ['employer', 'format', 'line', 'network', 'proof', 'run_id', 'salt']);
  for (const step of ada(s).proof) assert.deepEqual(Object.keys(step).sort(), ['hash', 'side']);
  assert.ok(!text.includes('declared_total'));
});

test('privacy: the same payroll built twice with real randomness shares no proof hashes', async () => {
  const input = await sampleInput();
  const a = await exportPayslips(await buildRun(input, { rng: makeRng() }), NETWORK);
  const b = await exportPayslips(await buildRun(input, { rng: makeRng() }), NETWORK);
  const ha = new Set(a.flatMap((p) => p.proof.map((x) => x.hash)));
  assert.ok(b.flatMap((p) => p.proof.map((x) => x.hash)).every((h) => !ha.has(h)));
});

test('privacy: an unseeded run does not reveal the true headcount in proof length', async () => {
  const input = await sampleInput();
  const small = { ...input, lines: input.lines.slice(0, 9) };
  const big = await buildRun(input, { rng: makeRng() });
  const mid = await buildRun(small, { rng: makeRng() });
  assert.equal(big.headcount_bucket, mid.headcount_bucket);
  const [pa] = await exportPayslips(big, NETWORK);
  const [pb] = await exportPayslips(mid, NETWORK);
  assert.equal(pa.proof.length, pb.proof.length);
});

// ---------------------------------------------------------------- disclosure packs
async function packs(s) {
  const net = NETWORK;
  return {
    eng: await exportDisclosure(s.run, { ...selectorFrom({ department: 'Engineering' }), network: net }),
    full: await exportDisclosure(s.run, { full: true, network: net }),
  };
}

test('disclosure subset: verifies and recomputes the subtotal; says what it did not verify', async () => {
  const s = await sampleSetup();
  const { eng } = await packs(s);
  const r = await verifyDisclosure(eng, s.record);
  assert.equal(r.ok, true);
  assert.equal(r.subtotal_cents, 580000 + 430000 + 615000);
  assert.equal(r.lines.length, 3);
  assert.match(r.summary, /VERIFIED SUBSET: 3 lines, subtotal 16,250.00 USD/);
  assert.ok(r.not_verified.some((x) => /company total/.test(x)));
  assert.ok(r.not_verified.some((x) => /complete/.test(x)));
});

test('disclosure subset: tampered amount, duplicated line, wrong proof, wrong root all fail', async () => {
  const s = await sampleSetup();
  const { eng } = await packs(s);
  const amount = clone(eng); amount.lines[0].line.amount_cents -= 100000;
  assert.equal((await verifyDisclosure(amount, s.record)).ok, false);
  const dup = clone(eng); dup.lines.push(clone(dup.lines[0]));
  const rd = await verifyDisclosure(dup, s.record);
  assert.equal(rd.ok, false);
  assert.match(rd.failure.text, /listed twice/);
  const proof = clone(eng); proof.lines[1].proof[0].hash = '11'.repeat(32);
  assert.equal((await verifyDisclosure(proof, s.record)).ok, false);
  const root = clone(eng); root.commitment.root = 'ee'.repeat(32);
  assert.equal((await verifyDisclosure(root, s.record)).ok, false);
  assert.equal((await verifyDisclosure(eng, recordFor(s.run, { revoked: true }))).ok, false);
  assert.equal((await verifyDisclosure(eng, null)).ok, false);
});

test('disclosure subset: an omitted line is NOT detected (documented limit)', async () => {
  const s = await sampleSetup();
  const { eng } = await packs(s);
  const omitted = clone(eng); omitted.lines.pop();
  const r = await verifyDisclosure(omitted, s.record);
  assert.equal(r.ok, true, 'a subset pack cannot prove completeness; the verifier says so in not_verified');
  assert.ok(r.not_verified.some((x) => /complete/.test(x)));
});

test('full audit: rebuilds the on-chain root, total equals the declared total', async () => {
  const s = await sampleSetup();
  const { full } = await packs(s);
  const r = await verifyDisclosure(full, s.record);
  assert.equal(r.ok, true);
  assert.equal(r.subtotal_cents, 3818000);
  assert.equal(r.padding_leaves, 5);
  assert.match(r.summary, /VERIFIED FULL AUDIT: 11 lines \(\+5 padding leaves\)/);
});

test('full audit: hiding a real line behind a padding seed, a changed line, or a wrong declared total all fail', async () => {
  const s = await sampleSetup();
  const { full } = await packs(s);
  const hidden = clone(full);
  const i = hidden.leaves.findIndex((l) => l.kind === 'line');
  hidden.leaves[i] = { kind: 'dummy', seed: '42'.repeat(32) };
  const rh = await verifyDisclosure(hidden, s.record);
  assert.equal(rh.ok, false);
  assert.match(rh.failure.text, /rebuild root/);
  const edited = clone(full);
  edited.leaves.find((l) => l.kind === 'line').line.amount_cents += 1;
  assert.equal((await verifyDisclosure(edited, s.record)).ok, false);
  const wrongTotal = await verifyDisclosure(full, recordFor(s.run, { declared_total_cents: 3818001 }));
  assert.equal(wrongTotal.ok, false);
  assert.match(wrongTotal.failure.text, /declared/);
  const short = clone(full); short.leaves.pop();
  assert.equal((await verifyDisclosure(short, s.record)).ok, false);
});
