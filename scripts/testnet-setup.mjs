// One-time setup of the public TESTNET deployment (never mainnet). It:
//   1. creates two THROWAWAY testnet accounts through the public NEAR testnet faucet (no sign-up),
//   2. deploys contracts/payroll-commit/res/payroll_commit.wasm to the first,
//   3. commits the sample payroll run as the second (the employer),
//   4. records the answer into fixtures/chain/testnet-recorded.json and exports sample payslips to samples/testnet/,
//   5. writes the contract id into config/networks.json.
// Keys are written to PSP_KEY_DIR, which MUST be outside this repository. They are never printed.
//   PSP_KEY_DIR=$HOME/.payslip-proof/testnet npm run testnet:setup
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { makeRng } from '../src/core/hash.js';
import { buildRun, commitmentOf, exportPayslips } from '../src/core/run.js';
import { ROOT, rpcViewGetRun, NETWORKS } from '../src/chain/sources.js';
import { loadNearKit, wasmInfo, commitOnChain } from '../src/chain/near.js';

const RPC = NETWORKS.testnet.rpc;
const FAUCET = 'https://helper.nearprotocol.com/account'; // the public faucet near-cli's `--useFaucet` uses
const keyDir = path.resolve(process.env.PSP_KEY_DIR ?? path.join(os.homedir(), '.payslip-proof', 'testnet'));
if (keyDir.startsWith(`${ROOT}${path.sep}`) || keyDir === ROOT) throw new Error('PSP_KEY_DIR must be outside the repository');
await mkdir(keyDir, { recursive: true, mode: 0o700 });

const kit = await loadNearKit();
const suffix = randomBytes(3).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function faucetAccount(id) {
  const key = kit.generateKey();
  const creds = { account_id: id, public_key: key.publicKey.toString(), private_key: key.secretKey };
  await writeFile(path.join(keyDir, `${id}.json`), JSON.stringify(creds), { mode: 0o600 });
  const res = await fetch(FAUCET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: creds.public_key }), signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`faucet answered HTTP ${res.status} for ${id}: ${(await res.text()).slice(0, 200)}`);
  console.log(`created testnet account ${id} (public key ${creds.public_key.slice(0, 18)}...)`);
  return new kit.Near({ network: 'testnet', rpcUrl: RPC, privateKey: key.secretKey, defaultSignerId: id });
}

const contractId = `payroll-commit-${suffix}.testnet`;
const employerId = `acme-payroll-${suffix}.testnet`;
const contractNear = await faucetAccount(contractId);
const employerNear = await faucetAccount(employerId);
for (let i = 0; i < 30 && !(await contractNear.accountExists(contractId) && await employerNear.accountExists(employerId)); i++) await sleep(1000);
const balance = await contractNear.getBalance(contractId);
console.log(`contract account balance: ${balance}`);

const { bytes, sha256 } = await wasmInfo();
const deployTx = await contractNear.transaction(contractId).deployContract(contractId, bytes).send();
console.log(`deployed payroll-commit (wasm sha256 ${sha256.slice(0, 16)}...) in tx ${deployTx.transaction.hash}`);

const input = JSON.parse(await readFile(path.join(ROOT, 'samples', 'payroll.sample.json'), 'utf8'));
const run = await buildRun(input, { rng: makeRng('psp-demo-seed-2026'), employer: employerId });
const { txHash } = await commitOnChain({ near: employerNear, contract: contractId, commitment: commitmentOf(run) });
console.log(`committed run ${run.run_id} root ${run.root.slice(0, 16)}... in tx ${txHash}`);

let record = null;
for (let i = 0; i < 20 && !record; i++) {
  await sleep(1500);
  record = await rpcViewGetRun({ rpc: RPC, contract: contractId, employer: employerId, runId: run.run_id, finality: 'final' }).catch(() => null);
}
if (!record) throw new Error('the commitment is not visible on testnet yet; run the setup again later or read it manually');

const explorer = NETWORKS.testnet.explorer;
await writeFile(path.join(ROOT, 'fixtures', 'chain', 'testnet-recorded.json'), `${JSON.stringify({
  _comment: 'RECORDED, not live. The get_run answer read back from NEAR TESTNET (https://test.rpc.fastnear.com) right after scripts/testnet-setup.mjs committed the sample run. The same record can be read live: npm run demo:testnet',
  network: 'testnet',
  contract: contractId,
  recorded_at: new Date().toISOString(),
  recorded_by: 'scripts/testnet-setup.mjs',
  wasm_sha256: sha256,
  transactions: [
    { action: 'deploy', hash: deployTx.transaction.hash, explorer: `${explorer}/txns/${deployTx.transaction.hash}` },
    { action: 'commit_run', run_id: run.run_id, hash: txHash, explorer: `${explorer}/txns/${txHash}` },
  ],
  runs: [record],
}, null, 2)}\n`);

const payslips = await exportPayslips(run, { name: 'testnet', contract: contractId });
const dir = path.join(ROOT, 'samples', 'testnet', 'payslips');
await mkdir(dir, { recursive: true });
for (const p of payslips) await writeFile(path.join(dir, `payslip-${p.line.employee_account}.json`), `${JSON.stringify(p, null, 2).replace(/\{\s+"side": "(left|right)",\s+"hash": "([0-9a-f]{64})"\s+\}/g, '{ "side": "$1", "hash": "$2" }')}\n`);
await writeFile(path.join(ROOT, 'samples', 'testnet', 'commitment.json'), `${JSON.stringify(commitmentOf(run), null, 2)}\n`);

const cfgPath = path.join(ROOT, 'config', 'networks.json');
const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
cfg.testnet.contract = contractId;
await writeFile(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
console.log(`\ntestnet contract : ${contractId}\ntestnet employer : ${employerId}\ncommit tx        : ${explorer}/txns/${txHash}\nwrote fixtures/chain/testnet-recorded.json, samples/testnet/, config/networks.json`);
