// Where the verifier reads the on-chain commitment from.
//   rpc      : a live view call to a NEAR RPC node (local sandbox, or testnet read-only). No key needed.
//   fixture  : a RECORDED answer saved from a real run; works with no network and says so loudly.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ChainUnavailable, rpcViewGetRun } from '../core/rpc.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NETWORKS = JSON.parse(await readFile(path.join(ROOT, 'config', 'networks.json'), 'utf8'));
export const DEFAULT_FIXTURE = path.join(ROOT, 'fixtures', 'chain', 'sandbox-recorded.json');
export const fixtureFor = (network) => {
  const f = path.join(ROOT, 'fixtures', 'chain', `${network}-recorded.json`);
  return existsSync(f) ? f : DEFAULT_FIXTURE;
};
// PAYSLIP_PROOF_SANDBOX_STATE lets the tests point somewhere else, so a sandbox you left running never changes their result
export const SANDBOX_STATE = process.env.PAYSLIP_PROOF_SANDBOX_STATE ?? path.join(ROOT, '.sandbox', 'state.json');

export { ChainUnavailable, rpcViewGetRun };

function rpcSource({ network, rpc, contract, finality, label }) {
  return {
    kind: 'rpc',
    network,
    contract,
    live: true,
    label: label ?? `${rpc} (${network}, contract ${contract})`,
    getRun: (employer, runId) => rpcViewGetRun({ rpc, contract, employer, runId, finality }),
  };
}

export async function fixtureSource(file = DEFAULT_FIXTURE) {
  const fx = JSON.parse(await readFile(file, 'utf8'));
  const rel = path.relative(ROOT, file) || file;
  return {
    kind: 'fixture',
    network: fx.network,
    contract: fx.contract,
    live: false,
    label: `${rel} (${fx.network}, contract ${fx.contract}, recorded ${fx.recorded_at}). Not a live chain read.`,
    getRun: async (employer, runId) => fx.runs.find((r) => r.employer === employer && r.run_id === runId) ?? null,
  };
}

async function sandboxState() {
  if (!existsSync(SANDBOX_STATE)) return null;
  return JSON.parse(await readFile(SANDBOX_STATE, 'utf8'));
}

export async function sandboxSource() {
  const st = await sandboxState();
  if (!st) throw new ChainUnavailable('no local sandbox is running');
  return rpcSource({
    network: 'sandbox',
    rpc: st.rpc,
    contract: st.contract,
    finality: NETWORKS.sandbox.finality,
    label: `local NEAR sandbox ${st.rpc} (contract ${st.contract})`,
  });
}

/**
 * Pick a source. mode: auto | fixture | sandbox | testnet | rpc
 * auto: a running local sandbox, else testnet read-only (when the payslip says testnet and a testnet
 * contract is configured), else the recorded fixture. Falling back is always reported, never silent.
 */
export async function resolveSource({ mode = 'auto', network, rpc, contract, fixture }) {
  const notes = [];
  const wantsTestnet = network === 'testnet';
  const fixtureFile = fixture ?? fixtureFor(network ?? 'sandbox');
  if (mode === 'fixture') return { source: await fixtureSource(fixtureFile), notes };
  if (mode === 'sandbox') return { source: await sandboxSource(), notes };
  if (mode === 'rpc') {
    if (!rpc) throw new Error('--chain rpc needs --rpc URL');
    return { source: rpcSource({ network: network ?? 'custom', rpc, contract }), notes };
  }
  if (mode === 'testnet') {
    const c = contract ?? NETWORKS.testnet.contract;
    if (!c) throw new ChainUnavailable('no testnet deployment is configured in config/networks.json');
    return { source: rpcSource({ network: 'testnet', rpc: rpc ?? NETWORKS.testnet.rpc, contract: c, finality: 'final' }), notes };
  }
  // auto
  if (!wantsTestnet) {
    try {
      const src = await sandboxSource();
      await src.getRun('probe.test.near', 'probe'); // reachability probe only
      return { source: src, notes };
    } catch (e) {
      notes.push(e.message);
    }
  } else if (NETWORKS.testnet.contract || contract) {
    try {
      const src = rpcSource({ network: 'testnet', rpc: rpc ?? NETWORKS.testnet.rpc, contract: contract ?? NETWORKS.testnet.contract, finality: 'final' });
      await src.getRun('probe.testnet', 'probe'); // reachability probe only
      return { source: src, notes };
    } catch (e) {
      notes.push(`testnet RPC: ${e.message}`);
    }
  } else {
    notes.push('testnet: no deployment configured');
  }
  return { source: await fixtureSource(fixtureFile), notes: [`no live chain reachable (${notes.join('; ')}), so this answer comes from the recorded fixture.${network === 'testnet' ? '' : ' For a live local chain: npm run sandbox'}`] };
}
