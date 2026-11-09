import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, SEED, sampleRun, clone } from './helpers.js';
import { rpcViewGetRun, ChainUnavailable, fixtureSource } from '../src/chain/sources.js';

const CLI = path.join(ROOT, 'bin', 'payslip-proof.js');
const run = (args) => new Promise((resolve) => {
  execFile(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, NO_COLOR: '1', PAYSLIP_PROOF_SANDBOX_STATE: path.join(tmpdir(), 'psp-no-such-sandbox', 'state.json') } }, (err, stdout, stderr) => {
    resolve({ code: err ? err.code : 0, stdout, stderr });
  });
});

let dir;
test.before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'psp-cli-'));
  const b = await run(['build-run', '--input', 'samples/payroll.sample.json', '--out', path.join(dir, 'run'), '--seed', SEED]);
  assert.equal(b.code, 0, b.stderr);
  const e = await run(['export-payslips', '--run', path.join(dir, 'run', 'run.private.json'), '--out', path.join(dir, 'ps'), '--network', 'sandbox']);
  assert.equal(e.code, 0, e.stderr);
});
test.after(() => rm(dir, { recursive: true, force: true }));
const ada = () => path.join(dir, 'ps', 'payslip-ada-lagos.testnet.json');

test('verify-payslip: verified, exit 0, exact summary line, labelled as recorded when no chain is up', async () => {
  const r = await run(['verify-payslip', ada(), '--chain', 'fixture']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^chain source: RECORDED/m);
  assert.match(r.stdout, /^VERIFIED: 5,800\.00 USD for 2026-10, paid by acme-payroll\.test\.near$/m);
});

test('verify-payslip: auto mode falls back to the fixture and says so', async () => {
  const r = await run(['verify-payslip', ada()]);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /recorded fixture/);
});

test('verify-payslip: --json is machine readable', async () => {
  const r = await run(['verify-payslip', ada(), '--chain', 'fixture', '--json']);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.live, false);
  assert.match(j.summary, /^VERIFIED: /);
});

test('verify-payslip: tampered amount exits 1 with FAILED', async () => {
  const p = JSON.parse(await readFile(ada(), 'utf8'));
  p.line.amount_cents += 1;
  const f = path.join(dir, 'bad.json');
  await writeFile(f, JSON.stringify(p));
  const r = await run(['verify-payslip', f, '--chain', 'fixture']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^FAILED: /m);
  assert.doesNotMatch(r.stdout, /VERIFIED/);
});

test('verify-payslip: a payslip pointing at an unofficial contract is refused', async () => {
  const p = JSON.parse(await readFile(ada(), 'utf8'));
  p.network.contract = 'evil-contract.test.near';
  const f = path.join(dir, 'evil.json');
  await writeFile(f, JSON.stringify(p));
  const r = await run(['verify-payslip', f, '--chain', 'fixture']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /official sandbox contract is payroll-commit\.test\.near/);
});

test('verify-payslip: revoked run (recorded from a real sandbox) exits 1', async () => {
  const b = await run(['build-run', '--input', 'samples/payroll.sample.json', '--out', path.join(dir, 'draft'), '--run-id', '2026-10-draft', '--seed', SEED]);
  assert.equal(b.code, 0);
  await run(['export-payslips', '--run', path.join(dir, 'draft', 'run.private.json'), '--out', path.join(dir, 'dps')]);
  const r = await run(['verify-payslip', path.join(dir, 'dps', 'payslip-ada-lagos.testnet.json'), '--chain', 'fixture']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /REVOKED/);
});

test('the recorded fixture still matches a deterministic rebuild of the sample (format drift alarm)', async () => {
  const src = await fixtureSource();
  const main = await sampleRun();
  const rec = await src.getRun(main.employer, main.run_id);
  assert.equal(rec.root, main.root);
  assert.equal(rec.declared_total_cents, String(main.declared_total_cents));
  assert.equal(rec.headcount_bucket, main.headcount_bucket);
  const { buildRun } = await import('../src/core/run.js');
  const { makeRng } = await import('../src/core/hash.js');
  const input = JSON.parse(await readFile(path.join(ROOT, 'samples', 'payroll.sample.json'), 'utf8'));
  const draft = await buildRun(input, { rng: makeRng(SEED), runId: '2026-10-draft' });
  const drec = await src.getRun(draft.employer, draft.run_id);
  assert.equal(drec.root, draft.root);
  assert.equal(drec.revoked, true);
});

test('disclosure via the CLI: subset and full audit verify, tampering fails', async () => {
  const runFile = path.join(dir, 'run', 'run.private.json');
  const sub = path.join(dir, 'sub.json');
  assert.equal((await run(['export-disclosure', '--run', runFile, '--department', 'Design', '--out', sub, '--network', 'sandbox'])).code, 0);
  const v = await run(['verify-disclosure', sub, '--chain', 'fixture']);
  assert.equal(v.code, 0, v.stdout);
  assert.match(v.stdout, /VERIFIED SUBSET: 2 lines, subtotal 7,350\.00 USD/);
  assert.match(v.stdout, /not verified: that this list is complete/);
  const full = path.join(dir, 'full.json');
  assert.equal((await run(['export-disclosure', '--run', runFile, '--all', '--out', full, '--network', 'sandbox'])).code, 0);
  const vf = await run(['verify-disclosure', full, '--chain', 'fixture']);
  assert.equal(vf.code, 0, vf.stdout);
  assert.match(vf.stdout, /VERIFIED FULL AUDIT: 11 lines \(\+5 padding leaves\)/);
  const bad = clone(JSON.parse(await readFile(sub, 'utf8')));
  bad.lines[0].line.amount_cents += 100;
  const badFile = path.join(dir, 'badsub.json');
  await writeFile(badFile, JSON.stringify(bad));
  assert.equal((await run(['verify-disclosure', badFile, '--chain', 'fixture'])).code, 1);
});

test('usage errors exit 2: unknown flag, missing file, bad input, unknown command, mainnet', async () => {
  assert.equal((await run(['verify-payslip', ada(), '--bogus'])).code, 2);
  assert.equal((await run(['verify-payslip', path.join(dir, 'nope.json')])).code, 2);
  assert.equal((await run(['verify-payslip'])).code, 2);
  assert.equal((await run(['frobnicate'])).code, 2);
  assert.equal((await run(['export-payslips', '--run', path.join(dir, 'run', 'run.private.json'), '--out', path.join(dir, 'x'), '--network', 'mainnet'])).code, 2);
  assert.equal((await run(['commit', '--run', path.join(dir, 'run', 'run.private.json'), '--network', 'mainnet'])).code, 2);
  const bad = path.join(dir, 'badinput.json');
  await writeFile(bad, JSON.stringify({ employer: 'a.near', run_id: 'r', period: '2026-10', currency: 'USD', lines: [{ employee_account: 'x.near', amount_cents: -4, payout_pref: { chain: 'eth', asset: 'ETH' } }] }));
  const r = await run(['build-run', '--input', bad, '--out', path.join(dir, 'y')]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /line 1/);
});

test('payout-preview prints a priced line per employee from the recorded quotes and flags them as recorded', async () => {
  const r = await run(['payout-preview', '--run', path.join(dir, 'run', 'run.private.json')]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /RECORDED/);
  assert.match(r.stdout, /DRY RUN ONLY/);
  assert.match(r.stdout, /11 of 11 lines priced/);
  const j = JSON.parse((await run(['payout-preview', '--run', path.join(dir, 'run', 'run.private.json'), '--json'])).stdout);
  assert.equal(j.cards.length, 11);
  assert.ok(j.cards.every((c) => ['quoted', 'expired'].includes(c.state) && c.source === 'recorded'));
});

test('no sandbox running: --chain sandbox fails clearly (exit 2) and says how to start one', async () => {
  const r = await run(['verify-payslip', ada(), '--chain', 'sandbox']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /npm run sandbox/);
});

test('rpc view: parses a contract answer and maps failures to ChainUnavailable', async () => {
  const answer = { employer: 'e.near', run_id: 'r', root: 'ab'.repeat(32), revoked: false };
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ result: { result: [...Buffer.from(JSON.stringify(answer))] } }) });
  assert.deepEqual(await rpcViewGetRun({ rpc: 'http://x', contract: 'c.near', employer: 'e.near', runId: 'r', fetchImpl: ok }), answer);
  const nul = async () => ({ ok: true, status: 200, json: async () => ({ result: { result: [...Buffer.from('null')] } }) });
  assert.equal(await rpcViewGetRun({ rpc: 'http://x', contract: 'c.near', employer: 'e.near', runId: 'r', fetchImpl: nul }), null);
  const down = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  await assert.rejects(() => rpcViewGetRun({ rpc: 'http://x', contract: 'c.near', employer: 'e.near', runId: 'r', fetchImpl: down }), ChainUnavailable);
  const rpcErr = async () => ({ ok: true, status: 200, json: async () => ({ result: { error: 'contract not deployed' } }) });
  await assert.rejects(() => rpcViewGetRun({ rpc: 'http://x', contract: 'c.near', employer: 'e.near', runId: 'r', fetchImpl: rpcErr }), /not deployed/);
  const http500 = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => rpcViewGetRun({ rpc: 'http://x', contract: 'c.near', employer: 'e.near', runId: 'r', fetchImpl: http500 }), ChainUnavailable);
});

test('an independent Python implementation (scripts/reference_verify.py) folds every payslip to the same root', async (t) => {
  const { spawnSync } = await import('node:child_process');
  if (spawnSync('python3', ['--version']).status !== 0) { t.skip('python3 is not installed'); return; }
  const rootHex = JSON.parse(await readFile(path.join(dir, 'run', 'run.private.json'), 'utf8')).root;
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(path.join(dir, 'ps'));
  assert.equal(files.length, 11);
  for (const f of files) {
    const r = spawnSync('python3', [path.join(ROOT, 'scripts', 'reference_verify.py'), path.join(dir, 'ps', f), '--root', rootHex], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /MATCH/);
  }
});
