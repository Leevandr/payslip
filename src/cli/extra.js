// Commands that need a signing key or a running chain: commit, revoke, sandbox. (payout-preview is below.)
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { commitmentOf } from '../core/run.js';
import { formatAmount } from '../core/encoding.js';
import { NETWORKS, SANDBOX_STATE, ROOT, rpcViewGetRun, ChainUnavailable } from '../chain/sources.js';
import { readJson, green, dim, bold, UsageError, ChainRefused } from './io.js';

function parse(args, options) {
  try {
    return parseArgs({ args, options, strict: true }).values;
  } catch (e) {
    throw new UsageError(e.message);
  }
}

async function readSandboxState() {
  try {
    return JSON.parse(await readFile(SANDBOX_STATE, 'utf8'));
  } catch {
    throw new UsageError('no local sandbox is running. In another terminal run: npm run sandbox');
  }
}

async function signerFor(network, run, values, state) {
  const nearLib = await import('../chain/near.js');
  if (network === 'sandbox') {
    const near = await nearLib.sandboxEmployer(state, run.employer);
    if (state.dirty) { delete state.dirty; await writeFile(SANDBOX_STATE, JSON.stringify(state, null, 2), { mode: 0o600 }); }
    return { near, contract: state.contract };
  }
  if (network === 'testnet') {
    const keyFile = values['key-file'] ?? process.env.NEAR_KEY_FILE;
    if (!keyFile) throw new UsageError('testnet needs a key file of a throwaway testnet account: --key-file PATH (or NEAR_KEY_FILE). Keep it outside the repo.');
    const contract = values.contract ?? NETWORKS.testnet.contract;
    if (!contract) throw new UsageError('no testnet contract configured in config/networks.json; pass --contract');
    const near = await nearLib.testnetEmployer({ accountId: run.employer, keyFile });
    return { near, contract };
  }
  throw new UsageError(`unknown network ${network}; use sandbox or testnet. Mainnet is deliberately not supported.`);
}

async function commitOrRevoke(cmd, args) {
  const values = parse(args, { run: { type: 'string' }, network: { type: 'string', default: 'sandbox' }, 'key-file': { type: 'string' }, contract: { type: 'string' } });
  if (!values.run) throw new UsageError('missing --run');
  const run = await readJson(values.run);
  const network = values.network;
  const state = network === 'sandbox' ? await readSandboxState() : null;
  const { near, contract } = await signerFor(network, run, values, state);
  const nearLib = await import('../chain/near.js');
  const rpc = network === 'sandbox' ? state.rpc : NETWORKS.testnet.rpc;
  const finality = NETWORKS[network].finality;
  console.log(`${cmd === 'commit' ? 'committing' : 'revoking'} run ${bold(run.run_id)} as ${run.employer} on ${network} (contract ${contract})`);
  let result;
  try {
    result = cmd === 'commit'
      ? await nearLib.commitOnChain({ near, contract, commitment: commitmentOf(run) })
      : await nearLib.revokeOnChain({ near, contract, runId: run.run_id });
  } catch (e) {
    const panic = /panicked: (.*)$/s.exec(e.message)?.[1];
    if (e.name === 'FunctionCallError' && panic) throw new ChainRefused(`the contract refused: ${panic}`);
    throw e;
  }
  const { txHash, record } = result;
  console.log(`  transaction : ${txHash}`);
  if (network === 'testnet') console.log(`  explorer    : ${NETWORKS.testnet.explorer}/txns/${txHash}`);
  // read it back through the same path a verifier uses
  let back = null;
  for (let i = 0; i < 10; i++) {
    try {
      back = await rpcViewGetRun({ rpc, contract, employer: run.employer, runId: run.run_id, finality });
    } catch (e) {
      if (!(e instanceof ChainUnavailable)) throw e;
    }
    if (back && (cmd === 'commit' || back.revoked)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`  on chain    : root ${(back ?? record)?.root}`);
  console.log(`                total ${formatAmount(Number((back ?? record).declared_total_cents))} ${(back ?? record).currency}, bucket ${(back ?? record).headcount_bucket}, revoked=${(back ?? record).revoked}`);
  console.log(green(cmd === 'commit' ? 'committed' : 'revoked'));
}

async function sandboxCmd(args) {
  parse(args, {});
  const nearLib = await import('../chain/near.js');
  const { sandbox, contract, wasmSha256 } = await nearLib.startSandbox();
  const state = {
    rpc: sandbox.rpcUrl,
    networkId: sandbox.networkId,
    root: { id: sandbox.rootAccount.id, secretKey: sandbox.rootAccount.secretKey },
    contract,
    wasm_sha256: wasmSha256,
    employers: {},
  };
  await mkdir(path.dirname(SANDBOX_STATE), { recursive: true });
  await writeFile(SANDBOX_STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`local NEAR sandbox is up: ${sandbox.rpcUrl}`);
  console.log(`contract payroll-commit deployed as ${contract} (wasm sha256 ${wasmSha256.slice(0, 16)}...)`);
  console.log(dim(`state file ${path.relative(ROOT, SANDBOX_STATE)} (throwaway sandbox keys only). Ctrl-C stops the chain and forgets everything.`));
  console.log(green('READY'));
  const keepAlive = setInterval(() => {}, 60_000); // the chain child is not ref'd; without this Node would exit at once
  await new Promise((resolve) => {
    const stop = async () => {
      clearInterval(keepAlive);
      await rm(SANDBOX_STATE, { force: true });
      await sandbox.stop();
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

export async function extra(cmd, args) {
  try {
    if (cmd === 'commit' || cmd === 'revoke') { await commitOrRevoke(cmd, args); return 0; }
    if (cmd === 'sandbox') { await sandboxCmd(args); return 0; }
    if (cmd === 'payout-preview') {
      const { payoutPreviewCommand } = await import('../intents/command.js');
      return await payoutPreviewCommand(args);
    }
  } catch (e) {
    if (e.usage) throw new UsageError(e.message);
    throw e;
  }
  throw new UsageError(`unknown command ${cmd}`);
}
