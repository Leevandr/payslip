// Re-records fixtures/chain/sandbox-recorded.json from a REAL local NEAR sandbox (real nearcore, the real wasm).
// Run it with: npm run record:chain      (needs `npm ci`; downloads the sandbox binary on first use)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeRng } from '../src/core/hash.js';
import { buildRun, commitmentOf } from '../src/core/run.js';
import { ROOT, rpcViewGetRun } from '../src/chain/sources.js';
import { startSandbox, sandboxEmployer, commitOnChain, revokeOnChain } from '../src/chain/near.js';

const SEED = 'psp-demo-seed-2026'; // public sample seed; see README
const input = JSON.parse(await readFile(path.join(ROOT, 'samples', 'payroll.sample.json'), 'utf8'));
const { sandbox, contract, wasmSha256 } = await startSandbox();
try {
  const state = { rpc: sandbox.rpcUrl, networkId: sandbox.networkId, root: sandbox.rootAccount, contract, employers: {} };
  const employer = await sandboxEmployer(state, input.employer);
  const transactions = [];
  const records = [];

  const main = await buildRun(input, { rng: makeRng(SEED) });
  let r = await commitOnChain({ near: employer, contract, commitment: commitmentOf(main) });
  transactions.push({ action: 'commit_run', run_id: main.run_id, hash: r.txHash });

  // A second run that the employer then revokes, so the "revoked" tamper case is a real chain state too.
  const draft = await buildRun(input, { rng: makeRng(SEED), runId: '2026-10-draft' });
  r = await commitOnChain({ near: employer, contract, commitment: commitmentOf(draft) });
  transactions.push({ action: 'commit_run', run_id: draft.run_id, hash: r.txHash });
  r = await revokeOnChain({ near: employer, contract, runId: draft.run_id });
  transactions.push({ action: 'revoke_run', run_id: draft.run_id, hash: r.txHash });

  await new Promise((res) => setTimeout(res, 3000)); // a view right after a call can be stale; wait
  for (const run of [main, draft]) {
    records.push(await rpcViewGetRun({ rpc: sandbox.rpcUrl, contract, employer: run.employer, runId: run.run_id, finality: 'final' }));
  }
  const fixture = {
    _comment: 'RECORDED, not live. Answers of the get_run view of the payroll-commit contract on a real local NEAR sandbox. Re-record with: npm run record:chain',
    network: 'sandbox',
    contract,
    recorded_at: new Date().toISOString(),
    recorded_by: 'scripts/record-chain-fixture.mjs',
    wasm_sha256: wasmSha256,
    transactions,
    runs: records,
  };
  const file = path.join(ROOT, 'fixtures', 'chain', 'sandbox-recorded.json');
  await writeFile(file, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`recorded ${records.length} runs from the sandbox into ${path.relative(ROOT, file)}`);
  for (const rec of records) console.log(`  ${rec.run_id}: root ${rec.root.slice(0, 16)}... revoked=${rec.revoked}`);
} finally {
  await sandbox.stop();
}
