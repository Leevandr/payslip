import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.js';

// Simulates "no network at all": every fetch() fails like an unreachable host. The verifier must still work,
// from the recorded fixtures, and must say that it did.
let dir;
test.before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'psp-offline-'));
  await writeFile(path.join(dir, 'no-net.mjs'), "globalThis.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENETUNREACH' } }); };\n");
});
test.after(() => rm(dir, { recursive: true, force: true }));

const run = (args) => new Promise((resolve) => {
  execFile(process.execPath, ['--import', path.join(dir, 'no-net.mjs'), path.join(ROOT, 'bin', 'payslip-proof.js'), ...args], {
    cwd: ROOT, env: { ...process.env, NO_COLOR: '1', PAYSLIP_PROOF_SANDBOX_STATE: path.join(dir, 'none.json') },
  }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
});

test('testnet payslip with no network: falls back to the recorded testnet answer and says so', async () => {
  const r = await run(['verify-payslip', 'samples/testnet/payslips/payslip-ada-lagos.testnet.json']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^chain source: RECORDED +fixtures\/chain\/testnet-recorded\.json/m);
  assert.match(r.stdout, /cannot reach https:\/\/test\.rpc\.fastnear\.com/);
  assert.match(r.stdout, /^VERIFIED: 5,800\.00 USD for 2026-10, paid by acme-payroll-/m);
});

test('testnet payslip with --chain testnet and no network: fails loudly (exit 1), never silently recorded', async () => {
  const r = await run(['verify-payslip', 'samples/testnet/payslips/payslip-ada-lagos.testnet.json', '--chain', 'testnet']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^chain source: LIVE/m);
  assert.match(r.stdout, /^FAILED: chain lookup failed: cannot reach/m);
  assert.doesNotMatch(r.stdout, /VERIFIED/);
});

test('the testnet disclosure packs verify offline from the recorded answer', async () => {
  for (const f of ['engineering', 'full-audit']) {
    const r = await run(['verify-disclosure', `samples/testnet/${f}.disclosure.json`]);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /^chain source: RECORDED/m);
  }
});

test('payout-preview works with no network (recorded quotes) and --live fails loudly', async () => {
  const { buildRun } = await import('../src/core/run.js');
  const { makeRng } = await import('../src/core/hash.js');
  const { sampleInput } = await import('./helpers.js');
  const run = await buildRun(await sampleInput(), { rng: makeRng('x') });
  const file = path.join(dir, 'run.private.json');
  await writeFile(file, JSON.stringify(run));
  const ok = await run_(['payout-preview', '--run', file]);
  assert.equal(ok.code, 0, ok.stderr);
  const live = await run_(['payout-preview', '--run', file, '--live']);
  assert.equal(live.code, 2);
  assert.match(live.stderr, /cannot reach the 1Click API/);
});

const run_ = run;
