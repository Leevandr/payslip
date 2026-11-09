// Employer side: build a payroll run, and export payslips / disclosure packs from it.
import { toHex, fromHex } from './bytes.js';
import {
  ValidationError, checks, normalizeLine, leafHash, dummyLeafHash, saltFromHex,
  SALT_BYTES, validateContext,
} from './encoding.js';
import { buildTree, proofFor } from './merkle.js';

export const MIN_CAPACITY = 8;
export const MAX_LINES = 1 << 16;

function must(cond, message) {
  if (!cond) throw new ValidationError(message);
}

/** Smallest power of two >= n, never below MIN_CAPACITY. This is the public "headcount bucket". */
export function capacityFor(n) {
  let c = MIN_CAPACITY;
  while (c < n) c *= 2;
  return c;
}

export function networkMeta(name, contract) {
  return { name, contract };
}

/**
 * input: { employer, run_id, period, currency, lines: [{employee_account, amount_cents, department?, payout_pref}] }
 * Lines may omit currency/period; they inherit the run's. Returns the PRIVATE run (holds all salts).
 */
export async function buildRun(input, { rng, employer, runId } = {}) {
  must(rng, 'an rng is required (use makeRng())');
  const ctx = validateContext({ employer: employer ?? input.employer, run_id: runId ?? input.run_id });
  must(checks.period(input.period), `period must be YYYY-MM, got ${JSON.stringify(input.period)}`);
  must(checks.currency(input.currency), `currency must be a 3-letter code, got ${JSON.stringify(input.currency)}`);
  must(Array.isArray(input.lines) && input.lines.length > 0, 'lines must be a non-empty array');
  must(input.lines.length <= MAX_LINES, `at most ${MAX_LINES} lines per run`);

  const lines = input.lines.map((raw, i) => {
    try {
      const l = normalizeLine({ currency: input.currency, period: input.period, ...raw });
      must(l.period === input.period, `line period ${l.period} differs from run period ${input.period}`);
      must(l.currency === input.currency, `line currency ${l.currency} differs from run currency ${input.currency}; one currency per run`);
      return l;
    } catch (e) {
      throw new ValidationError(`line ${i + 1}: ${e.message}`);
    }
  });
  const seen = new Set();
  for (const l of lines) {
    must(!seen.has(l.employee_account), `employee ${l.employee_account} appears twice; merge their pay into one line`);
    seen.add(l.employee_account);
  }
  const declared_total_cents = lines.reduce((s, l) => s + l.amount_cents, 0);
  must(Number.isSafeInteger(declared_total_cents), 'total exceeds the safe integer range');

  const capacity = capacityFor(lines.length);
  const entries = [];
  for (const line of lines) entries.push({ kind: 'line', line, salt: await rng.bytes(SALT_BYTES) });
  for (let i = lines.length; i < capacity; i++) entries.push({ kind: 'dummy', seed: await rng.bytes(32) });
  // Random order, so a leaf's position in the tree says nothing about who or how much.
  for (let i = entries.length - 1; i > 0; i--) {
    const j = await rng.int(i + 1);
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }

  const run = {
    format: 'payslip-proof/run-private/v1',
    WARNING: 'EMPLOYER PRIVATE. Holds every pay line and every salt. Never publish or send this file.',
    employer: ctx.employer,
    run_id: ctx.run_id,
    period: input.period,
    currency: input.currency,
    declared_total_cents,
    headcount_bucket: capacity,
    salts: rng.deterministic ? 'deterministic-demo-seed (NOT private)' : 'os-csprng',
    leaves: entries.map((e) => (e.kind === 'line'
      ? { kind: 'line', line: e.line, salt: toHex(e.salt) }
      : { kind: 'dummy', seed: toHex(e.seed) })),
  };
  const { root } = await rebuild(run);
  run.root = toHex(root);
  return run;
}

/** Recompute all leaf hashes and the tree from a private run. */
export async function rebuild(run) {
  must(run && run.format === 'payslip-proof/run-private/v1', 'not a payslip-proof private run file');
  const ctx = validateContext(run);
  const hashes = [];
  for (const e of run.leaves) {
    if (e.kind === 'line') hashes.push(await leafHash(ctx, e.line, saltFromHex(e.salt)));
    else if (e.kind === 'dummy') hashes.push(await dummyLeafHash(fromHex(e.seed, 32)));
    else throw new ValidationError(`unknown leaf kind ${e.kind}`);
  }
  const tree = await buildTree(hashes);
  return { ctx, hashes, tree, root: tree.root };
}

/** The public data that goes on chain. */
export function commitmentOf(run) {
  return {
    employer: run.employer,
    run_id: run.run_id,
    root: run.root,
    period: run.period,
    currency: run.currency,
    declared_total_cents: run.declared_total_cents,
    headcount_bucket: run.headcount_bucket,
  };
}

async function loadChecked(run) {
  const built = await rebuild(run);
  must(toHex(built.root) === run.root, 'run file is inconsistent: stored root differs from the recomputed root');
  return built;
}

function proofEntry(run, built, index) {
  const e = run.leaves[index];
  return { line: e.line, salt: e.salt, proof: proofFor(built.tree.levels, index) };
}

/** One payslip file per real line. Contains the line, its salt, and sibling hashes only. */
export async function exportPayslips(run, network) {
  const built = await loadChecked(run);
  const out = [];
  run.leaves.forEach((e, index) => {
    if (e.kind !== 'line') return;
    out.push({
      format: 'payslip-proof/payslip/v1',
      employer: run.employer,
      run_id: run.run_id,
      network,
      ...proofEntry(run, built, index),
    });
  });
  return out;
}

/**
 * Disclosure pack for a subset (selector: line => boolean), or the whole run ("full audit").
 * A subset pack proves each listed line is in the commitment. It cannot prove the list is complete.
 * A full pack reveals every leaf (real lines and padding seeds), so the auditor can rebuild the whole root.
 */
export async function exportDisclosure(run, { selector, selectorText, full = false, network }) {
  const built = await loadChecked(run);
  const head = {
    format: 'payslip-proof/disclosure/v1',
    employer: run.employer,
    run_id: run.run_id,
    network,
    commitment: commitmentOf(run),
  };
  if (full) {
    return { ...head, scope: { kind: 'full' }, leaves: run.leaves.map((e) => ({ ...e })) };
  }
  const lines = [];
  run.leaves.forEach((e, index) => {
    if (e.kind === 'line' && selector(e.line)) lines.push(proofEntry(run, built, index));
  });
  must(lines.length > 0, `selector ${selectorText} matched no lines`);
  return { ...head, scope: { kind: 'subset', selector: selectorText }, lines };
}

export function selectorFrom({ department, accounts }) {
  if (department !== undefined) return { selector: (l) => l.department === department, selectorText: `department=${department}` };
  if (accounts !== undefined) {
    const set = new Set(accounts);
    return { selector: (l) => set.has(l.employee_account), selectorText: `accounts=${accounts.join(',')}` };
  }
  throw new ValidationError('give --department NAME, --accounts a,b,c or --all');
}
