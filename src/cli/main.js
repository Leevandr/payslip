import { parseArgs } from 'node:util';
import path from 'node:path';
import { makeRng } from '../core/hash.js';
import { formatAmount } from '../core/encoding.js';
import { buildRun, commitmentOf, exportPayslips, exportDisclosure, selectorFrom, networkMeta, capacityFor } from '../core/run.js';
import { verifyPayslip, verifyDisclosure } from '../core/verify.js';
import { NETWORKS, resolveSource, ChainUnavailable } from '../chain/sources.js';
import { readJson, writeJson, printChecks, green, red, dim, bold, yellow, UsageError, ChainRefused } from './io.js';

const HELP = `payslip-proof: proof of income you can verify without exposing anyone else's pay

Employer side
  build-run         --input payroll.json --out DIR [--employer ACCOUNT] [--run-id ID] [--seed TEXT]
  export-payslips   --run DIR/run.private.json --out DIR [--network sandbox|testnet]
  export-disclosure --run DIR/run.private.json --out FILE (--department NAME | --accounts a,b | --all) [--network ...]
  commit            --run DIR/run.private.json --network sandbox|testnet     (writes the root to NEAR)
  revoke            --run DIR/run.private.json --network sandbox|testnet     (marks the run revoked)
  payout-preview    --run DIR/run.private.json [--live]                      (what each person would receive)
  sandbox                                                                    (start a local NEAR sandbox + contract)

Verifier side
  verify-payslip    FILE [--chain auto|fixture|sandbox|testnet|rpc] [--rpc URL] [--contract ID] [--fixture FILE] [--json] [--brief]
  verify-disclosure FILE [same chain options]

Exit codes: 0 verified / done, 1 verification failed, 2 bad input or usage, 3 the chain refused a transaction, 70 internal error.
Unknown flags are rejected, not ignored.`;

const common = {
  network: { type: 'string' },
  chain: { type: 'string', default: 'auto' },
  rpc: { type: 'string' },
  contract: { type: 'string' },
  fixture: { type: 'string' },
  json: { type: 'boolean', default: false },
  brief: { type: 'boolean', default: false },
};

function opts(args, extra, positionals = false) {
  try {
    return parseArgs({ args, options: { ...extra }, allowPositionals: positionals, strict: true });
  } catch (e) {
    throw new UsageError(e.message);
  }
}

function need(v, flag) {
  if (v === undefined) throw new UsageError(`missing ${flag}`);
  return v;
}

function networkFor(name, contractOverride) {
  const n = name ?? 'sandbox';
  if (!NETWORKS[n]) throw new UsageError(`unknown network ${n}; use sandbox or testnet (mainnet is deliberately not supported)`);
  const contract = contractOverride ?? NETWORKS[n].contract;
  if (!contract) throw new UsageError(`no contract is configured for ${n} in config/networks.json; pass --contract`);
  return networkMeta(n, contract);
}

async function cmdBuildRun(args) {
  const { values } = opts(args, {
    input: { type: 'string' }, out: { type: 'string' }, employer: { type: 'string' },
    'run-id': { type: 'string' }, seed: { type: 'string' },
  });
  const input = await readJson(need(values.input, '--input'));
  const out = need(values.out, '--out');
  const rng = makeRng(values.seed);
  const run = await buildRun(input, { rng, employer: values.employer, runId: values['run-id'] });
  await writeJson(path.join(out, 'run.private.json'), run, { secret: true });
  await writeJson(path.join(out, 'commitment.json'), commitmentOf(run));
  const real = run.leaves.filter((l) => l.kind === 'line').length;
  console.log(`built run ${bold(run.run_id)} for ${run.employer}, period ${run.period}`);
  console.log(`  lines            : ${real} real + ${run.headcount_bucket - real} random padding leaves = ${run.headcount_bucket} leaves (public bucket: ${run.headcount_bucket})`);
  console.log(`  declared total   : ${formatAmount(run.declared_total_cents)} ${run.currency}`);
  console.log(`  merkle root      : ${run.root}`);
  console.log(`  private file     : ${path.join(out, 'run.private.json')}  ${yellow('(secret: holds every salt)')}`);
  console.log(`  public commitment: ${path.join(out, 'commitment.json')}`);
  if (rng.deterministic) console.log(yellow('  NOTE: --seed makes salts and padding deterministic. Use it only for the public sample; real runs omit it.'));
}

async function cmdExportPayslips(args) {
  const { values } = opts(args, { run: { type: 'string' }, out: { type: 'string' }, network: { type: 'string' }, contract: { type: 'string' } });
  const run = await readJson(need(values.run, '--run'));
  const out = need(values.out, '--out');
  const payslips = await exportPayslips(run, networkFor(values.network, values.contract));
  for (const p of payslips) await writeJson(path.join(out, `payslip-${p.line.employee_account}.json`), p);
  console.log(`wrote ${payslips.length} payslips to ${out}/ (each holds one line, its salt and ${payslips[0]?.proof.length} sibling hashes; nothing about anyone else)`);
}

async function cmdExportDisclosure(args) {
  const { values } = opts(args, {
    run: { type: 'string' }, out: { type: 'string' }, network: { type: 'string' }, contract: { type: 'string' },
    department: { type: 'string' }, accounts: { type: 'string' }, all: { type: 'boolean', default: false },
  });
  const run = await readJson(need(values.run, '--run'));
  const network = networkFor(values.network, values.contract);
  let pack;
  if (values.all) {
    pack = await exportDisclosure(run, { full: true, network });
  } else {
    const sel = selectorFrom({ department: values.department, accounts: values.accounts?.split(',') });
    pack = await exportDisclosure(run, { ...sel, network });
  }
  await writeJson(need(values.out, '--out'), pack, { secret: values.all });
  console.log(values.all
    ? `wrote FULL audit pack to ${values.out}: it reveals every line and the true headcount to whoever receives it`
    : `wrote subset disclosure pack (${pack.scope.selector}, ${pack.lines.length} lines) to ${values.out}`);
}

async function chainFor(values, file) {
  const network = values.network ?? file.network?.name;
  let source; let notes;
  try {
    ({ source, notes } = await resolveSource({
      mode: values.chain, network, rpc: values.rpc, contract: values.contract, fixture: values.fixture,
    }));
  } catch (e) {
    if (e instanceof ChainUnavailable) throw new UsageError(`${e.message}${values.chain === 'sandbox' ? ' (start one with: npm run sandbox)' : ''}`);
    throw e;
  }
  return { source, notes };
}

function contractGuard(file, source, values) {
  const claimed = file.network;
  if (!claimed?.contract) return { ok: false, text: 'the file does not say which contract holds the commitment' };
  if (values.contract) return { ok: true, text: `using the contract you passed explicitly: ${values.contract} (not the official one)`, warn: true };
  const official = NETWORKS[claimed.name]?.contract;
  if (official && claimed.contract !== official) {
    return { ok: false, text: `the file points at contract ${claimed.contract}, but the official ${claimed.name} contract is ${official}` };
  }
  if (!official) return { ok: false, text: `no official contract is configured for network ${claimed.name}` };
  if (source.contract !== claimed.contract) {
    return { ok: false, text: `the chain source reads contract ${source.contract}, the file names ${claimed.contract}` };
  }
  return { ok: true, text: `contract ${claimed.contract} is the official ${claimed.name} contract` };
}

async function runVerification(kind, args) {
  const { values, positionals } = opts(args, common, true);
  const file = positionals[0];
  if (!file) throw new UsageError(`usage: ${kind} FILE [--chain ...]`);
  const doc = await readJson(file);
  const { source, notes } = await chainFor(values, doc);
  const guard = contractGuard(doc, source, values);
  let record = null;
  let lookupError = null;
  if (guard.ok) {
    try {
      record = await source.getRun(doc.employer, doc.run_id);
    } catch (e) {
      lookupError = e.message;
    }
  }
  const result = kind === 'verify-payslip' ? await verifyPayslip(doc, record) : await verifyDisclosure(doc, record);
  // The contract/source guard is part of the verdict.
  const checks = [{ ok: guard.ok, text: guard.text }, ...result.checks];
  let ok = result.ok && guard.ok && !lookupError;
  let failure = !guard.ok ? checks[0] : result.failure;
  if (lookupError) { ok = false; failure = { text: `chain lookup failed: ${lookupError}` }; }

  if (values.json) {
    console.log(JSON.stringify({ ok, source: source.label, live: source.live, checks, summary: ok ? result.summary : null, failure: failure?.text ?? null, not_verified: result.not_verified ?? [] }, null, 2));
    return ok ? 0 : 1;
  }
  console.log(`chain source: ${source.live ? green('LIVE') : yellow('RECORDED')}  ${source.label}`);
  for (const n of notes) console.log(dim(`  note: ${n}`));
  if (!values.brief) printChecks(checks);
  if (ok) {
    console.log(green(result.summary));
    for (const n of result.not_verified ?? []) console.log(dim(`  not verified: ${n}`));
    return 0;
  }
  console.log(red(`FAILED: ${failure?.text ?? 'unknown reason'}`));
  return 1;
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case 'build-run': await cmdBuildRun(rest); return 0;
      case 'export-payslips': await cmdExportPayslips(rest); return 0;
      case 'export-disclosure': await cmdExportDisclosure(rest); return 0;
      case 'verify-payslip': return await runVerification('verify-payslip', rest);
      case 'verify-disclosure': return await runVerification('verify-disclosure', rest);
      case 'commit': case 'revoke': case 'sandbox': case 'payout-preview': {
        const { extra } = await import('./extra.js');
        return await extra(cmd, rest);
      }
      case undefined: case 'help': case '--help': case '-h': console.log(HELP); return cmd ? 0 : 2;
      default: throw new UsageError(`unknown command ${cmd}\n\n${HELP}`);
    }
  } catch (e) {
    if (e instanceof UsageError || e.name === 'ValidationError') {
      console.error(red(`error: ${e.message}`));
      return 2;
    }
    if (e instanceof ChainRefused) {
      console.error(red(`error: ${e.message}`));
      return 3;
    }
    throw e;
  }
}

export { capacityFor };
