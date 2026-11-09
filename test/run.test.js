import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/core/hash.js';
import { buildRun, rebuild, capacityFor, exportDisclosure, selectorFrom, commitmentOf } from '../src/core/run.js';
import { ValidationError } from '../src/core/encoding.js';
import { sampleInput, sampleRun, SEED, clone } from './helpers.js';

test('sample run: deterministic with a seed, random without', async () => {
  const a = await sampleRun();
  const b = await sampleRun();
  assert.equal(a.root, b.root);
  const c = await buildRun(await sampleInput(), { rng: makeRng() });
  const d = await buildRun(await sampleInput(), { rng: makeRng() });
  assert.notEqual(c.root, d.root, 'unseeded runs must use fresh salts');
  assert.equal(c.salts, 'os-csprng');
});

test('sample run: root is pinned (a format change must be a conscious decision)', async () => {
  const run = await sampleRun();
  assert.equal(run.root, '11b07b6364d1dbf8c17888e82f5147ecffc297782f89f57e7b7d164368cebd12');
  assert.equal(run.declared_total_cents, 3818000);
  assert.equal(run.headcount_bucket, 16);
});

test('padding hides the headcount: 11 lines are committed as a bucket of 16, with padding leaves', async () => {
  const run = await sampleRun();
  assert.equal(run.leaves.length, 16);
  assert.equal(run.leaves.filter((l) => l.kind === 'line').length, 11);
  assert.equal(run.leaves.filter((l) => l.kind === 'dummy').length, 5);
  assert.deepEqual([1, 8, 9, 16, 17, 33, 100].map(capacityFor), [8, 8, 16, 16, 32, 64, 128]);
});

test('leaf order is shuffled: tree position does not follow input order', async () => {
  const input = await sampleInput();
  const run = await sampleRun();
  const order = run.leaves.filter((l) => l.kind === 'line').map((l) => l.line.employee_account);
  assert.notDeepEqual(order, input.lines.map((l) => l.employee_account));
  // dummies are not all bunched at the end
  const firstDummy = run.leaves.findIndex((l) => l.kind === 'dummy');
  assert.ok(firstDummy < 11, `first padding leaf at ${firstDummy}`);
});

test('rebuild reproduces the stored root and rejects a doctored private file', async () => {
  const run = await sampleRun();
  const { root } = await rebuild(run);
  assert.equal(Buffer.from(root).toString('hex'), run.root);
  const doctored = clone(run);
  doctored.leaves.find((l) => l.kind === 'line').line.amount_cents += 1;
  const { exportPayslips } = await import('../src/core/run.js');
  await assert.rejects(() => exportPayslips(doctored, { name: 'sandbox', contract: 'x.near' }), /inconsistent/);
});

test('input validation: duplicates, mixed currency, wrong period, empty, bad employer', async () => {
  const input = await sampleInput();
  const rng = () => makeRng(SEED);
  const dup = clone(input); dup.lines[1].employee_account = dup.lines[0].employee_account;
  await assert.rejects(() => buildRun(dup, { rng: rng() }), /appears twice/);
  const cur = clone(input); cur.lines[2].currency = 'EUR';
  await assert.rejects(() => buildRun(cur, { rng: rng() }), /one currency per run/);
  const per = clone(input); per.lines[3].period = '2026-09';
  await assert.rejects(() => buildRun(per, { rng: rng() }), /differs from run period/);
  const empty = clone(input); empty.lines = [];
  await assert.rejects(() => buildRun(empty, { rng: rng() }), ValidationError);
  await assert.rejects(() => buildRun(input, { rng: rng(), employer: 'Not A Valid Account' }), ValidationError);
  const neg = clone(input); neg.lines[0].amount_cents = -1;
  await assert.rejects(() => buildRun(neg, { rng: rng() }), /line 1/);
});

test('the commitment holds only root, period, currency, total, bucket and identity', async () => {
  const c = commitmentOf(await sampleRun());
  assert.deepEqual(Object.keys(c).sort(), ['currency', 'declared_total_cents', 'employer', 'headcount_bucket', 'period', 'root', 'run_id']);
});

test('disclosure selectors and a selector with no match', async () => {
  const run = await sampleRun();
  const net = { name: 'sandbox', contract: 'payroll-commit.test.near' };
  const eng = await exportDisclosure(run, { ...selectorFrom({ department: 'Engineering' }), network: net });
  assert.equal(eng.lines.length, 3);
  const two = await exportDisclosure(run, { ...selectorFrom({ accounts: ['ada-lagos.testnet', 'bao-hanoi.testnet'] }), network: net });
  assert.equal(two.lines.length, 2);
  await assert.rejects(() => exportDisclosure(run, { ...selectorFrom({ department: 'Legal' }), network: net }), /matched no lines/);
  assert.throws(() => selectorFrom({}), /--department/);
});
