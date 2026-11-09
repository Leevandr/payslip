// Everything that talks to a NEAR node with a signing key. Loaded lazily: verifying a payslip never needs it.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT } from './sources.js';

export const WASM_PATH = path.join(ROOT, 'contracts', 'payroll-commit', 'res', 'payroll_commit.wasm');
export const SANDBOX_CONTRACT = 'payroll-commit.test.near';

export async function loadNearKit() {
  try {
    const kit = await import('near-kit');
    const { Sandbox } = await import('near-kit/sandbox');
    return { ...kit, Sandbox };
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') {
      throw Object.assign(new Error('the chain commands need the one dependency: run `npm ci` first'), { usage: true });
    }
    throw e;
  }
}

export async function wasmInfo() {
  const bytes = await readFile(WASM_PATH);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}

/** Start a throwaway local chain, deploy the contract on it. Nothing here touches a real network. */
export async function startSandbox() {
  const kit = await loadNearKit();
  // detached:false ties the chain to this process, so a crash cannot leave an orphan chain behind
  const sandbox = await kit.Sandbox.start({ detached: false });
  const near = new kit.Near({ network: sandbox });
  const { bytes, sha256 } = await wasmInfo();
  const keyPair = kit.generateKey();
  await near
    .transaction(sandbox.rootAccount.id)
    .createAccount(SANDBOX_CONTRACT)
    .transfer(SANDBOX_CONTRACT, '10 NEAR')
    .addKey(keyPair.publicKey.toString(), { type: 'fullAccess' })
    .deployContract(SANDBOX_CONTRACT, bytes)
    .send();
  return { kit, sandbox, near, contract: SANDBOX_CONTRACT, wasmSha256: sha256 };
}

/** A signer for `accountId`; in the sandbox the account is created on demand with a fresh throwaway key. */
export async function sandboxEmployer(state, accountId) {
  const kit = await loadNearKit();
  const root = new kit.Near({ network: { rpcUrl: state.rpc, networkId: state.networkId }, privateKey: state.root.secretKey, defaultSignerId: state.root.id });
  state.employers ??= {};
  if (!state.employers[accountId]) {
    const key = kit.generateKey();
    await root
      .transaction(state.root.id)
      .createAccount(accountId)
      .transfer(accountId, '5 NEAR')
      .addKey(key.publicKey.toString(), { type: 'fullAccess' })
      .send();
    state.employers[accountId] = key.secretKey;
    state.dirty = true;
  }
  return new kit.Near({ network: { rpcUrl: state.rpc, networkId: state.networkId }, privateKey: state.employers[accountId], defaultSignerId: accountId });
}

export async function testnetEmployer({ accountId, keyFile }) {
  const kit = await loadNearKit();
  const resolved = path.resolve(keyFile);
  if (resolved.startsWith(`${ROOT}${path.sep}`)) {
    throw Object.assign(new Error('refusing to read a key file from inside this repository; keep keys outside it (see .env.example)'), { usage: true });
  }
  let creds;
  try {
    creds = JSON.parse(await readFile(resolved, 'utf8'));
  } catch {
    throw Object.assign(new Error(`cannot read the key file ${resolved}`), { usage: true });
  }
  const secret = creds.private_key ?? creds.secret_key ?? creds.secretKey;
  if (!secret) throw Object.assign(new Error('the key file has no private_key field'), { usage: true });
  if (creds.account_id && creds.account_id !== accountId) {
    throw Object.assign(new Error(`the key file belongs to ${creds.account_id}, not ${accountId}`), { usage: true });
  }
  return new kit.Near({ network: 'testnet', rpcUrl: 'https://test.rpc.fastnear.com', privateKey: secret, defaultSignerId: accountId });
}

function decodeSuccess(outcome) {
  const v = outcome?.status?.SuccessValue;
  return v ? JSON.parse(Buffer.from(v, 'base64').toString('utf8')) : null;
}

export async function commitOnChain({ near, contract, commitment, depositNear = '0.01 NEAR' }) {
  const out = await near.call(
    contract,
    'commit_run',
    {
      run_id: commitment.run_id,
      root: commitment.root,
      period: commitment.period,
      currency: commitment.currency,
      declared_total_cents: String(commitment.declared_total_cents),
      headcount_bucket: commitment.headcount_bucket,
    },
    { attachedDeposit: depositNear, gas: '30 Tgas' },
  );
  return { txHash: out.transaction.hash, record: decodeSuccess(out) };
}

export async function revokeOnChain({ near, contract, runId }) {
  const out = await near.call(contract, 'revoke_run', { run_id: runId }, { gas: '30 Tgas' });
  return { txHash: out.transaction.hash, record: decodeSuccess(out) };
}
