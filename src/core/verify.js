// Verifier side. Pure functions: they take a file and a chain record and return a list of checks.
// Nothing here touches the network or the disk, so the browser page runs the very same code.
import { toHex, fromHex, bytesEqual } from './bytes.js';
import {
  ValidationError, checks as fmt, leafHash, dummyLeafHash, saltFromHex, validateContext, normalizeLine, formatAmount,
} from './encoding.js';
import { rootFromProof, buildTree } from './merkle.js';

const HEX64 = /^[0-9a-f]{64}$/;

class Checklist {
  constructor() {
    this.items = [];
    this.failed = false;
  }
  pass(id, text) {
    this.items.push({ id, ok: true, text });
  }
  fail(id, text) {
    this.items.push({ id, ok: false, text });
    this.failed = true;
  }
  get ok() {
    return !this.failed;
  }
  get firstFailure() {
    return this.items.find((i) => !i.ok);
  }
}

function log2Exact(n) {
  return Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0 ? Math.log2(n) : null;
}

/** Validate a chain record (from the contract view, a fixture, or the sandbox) into a canonical shape. */
export function normalizeRecord(r) {
  if (!r) return null;
  const total = typeof r.declared_total_cents === 'string' ? Number(r.declared_total_cents) : r.declared_total_cents;
  return {
    employer: r.employer,
    run_id: r.run_id,
    root: r.root,
    period: r.period,
    currency: r.currency,
    declared_total_cents: total,
    headcount_bucket: r.headcount_bucket,
    committed_at_ms: r.committed_at_ms == null ? null : Number(r.committed_at_ms),
    revoked: Boolean(r.revoked),
    revoked_at_ms: r.revoked_at_ms == null ? null : Number(r.revoked_at_ms),
  };
}

/** Checks shared by payslip and disclosure verification: is there an unrevoked commitment, and is the file about it? */
function checkRecord(c, file, record) {
  if (!record) {
    c.fail('commitment', `no commitment found on chain for ${file.employer} / run ${file.run_id}`);
    return false;
  }
  c.pass('commitment', `commitment found for ${record.employer} / run ${record.run_id} (period ${record.period}, bucket ${record.headcount_bucket})`);
  if (record.employer !== file.employer || record.run_id !== file.run_id) {
    c.fail('commitment-identity', 'the chain record belongs to a different employer or run than the file claims');
    return false;
  }
  if (!HEX64.test(record.root ?? '')) {
    c.fail('commitment-root', 'the chain record has no valid 32-byte root');
    return false;
  }
  if (record.revoked) {
    const t = record.revoked_at_ms ? new Date(record.revoked_at_ms) : null;
    const when = t && !Number.isNaN(t.getTime()) ? ` on ${t.toISOString().slice(0, 10)}` : '';
    c.fail('not-revoked', `the employer REVOKED this run${when}; its payslips are no longer valid`);
    return false;
  }
  c.pass('not-revoked', 'run is not revoked');
  return true;
}

export async function verifyPayslip(payslip, rawRecord) {
  const c = new Checklist();
  const record = normalizeRecord(rawRecord);
  let leaf;
  let line;
  try {
    if (payslip?.format !== 'payslip-proof/payslip/v1') throw new ValidationError('not a payslip-proof payslip file (format field)');
    const ctx = validateContext(payslip);
    line = normalizeLine(payslip.line);
    if (!Array.isArray(payslip.proof)) throw new ValidationError('proof must be an array');
    leaf = await leafHash(ctx, line, saltFromHex(payslip.salt));
    c.pass('leaf', `leaf recomputed from the line and its salt: ${toHex(leaf).slice(0, 16)}...`);
  } catch (e) {
    c.fail('leaf', `malformed payslip: ${e.message}`);
    return { ok: false, checks: c.items, failure: c.firstFailure, line: null };
  }

  let root;
  try {
    root = await rootFromProof(leaf, payslip.proof);
    c.pass('root', `${payslip.proof.length} sibling hashes fold the leaf up to root ${toHex(root).slice(0, 16)}...`);
  } catch (e) {
    c.fail('root', `malformed proof: ${e.message}`);
    return { ok: false, checks: c.items, failure: c.firstFailure, line };
  }

  if (!checkRecord(c, payslip, record)) return { ok: false, checks: c.items, failure: c.firstFailure, line };

  if (toHex(root) !== record.root) {
    c.fail('root-match', `recomputed root ${toHex(root).slice(0, 16)}... does not equal the committed root ${record.root.slice(0, 16)}...`);
  } else {
    c.pass('root-match', 'recomputed root equals the committed root');
  }
  const depth = log2Exact(record.headcount_bucket);
  if (depth === null || payslip.proof.length !== depth) {
    c.fail('depth', `proof has ${payslip.proof.length} steps but the committed bucket ${record.headcount_bucket} needs ${depth ?? 'a power of two'}`);
  } else {
    c.pass('depth', `proof depth ${depth} matches the committed headcount bucket ${record.headcount_bucket}`);
  }
  if (line.period !== record.period) c.fail('period', `line period ${line.period} differs from committed period ${record.period}`);
  else c.pass('period', `period ${line.period} matches the commitment`);
  if (line.currency !== record.currency) c.fail('currency', `line currency ${line.currency} differs from committed currency ${record.currency}`);
  else c.pass('currency', `currency ${line.currency} matches the commitment`);

  const ok = c.ok;
  return {
    ok,
    checks: c.items,
    failure: c.firstFailure,
    line,
    summary: ok ? `VERIFIED: ${formatAmount(line.amount_cents)} ${line.currency} for ${line.period}, paid by ${payslip.employer}` : null,
  };
}

export async function verifyDisclosure(pack, rawRecord) {
  const c = new Checklist();
  const record = normalizeRecord(rawRecord);
  const fail = () => ({ ok: false, checks: c.items, failure: c.firstFailure });
  if (pack?.format !== 'payslip-proof/disclosure/v1') {
    c.fail('format', 'not a payslip-proof disclosure pack (format field)');
    return fail();
  }
  let ctx;
  try {
    ctx = validateContext(pack);
  } catch (e) {
    c.fail('format', e.message);
    return fail();
  }
  if (!checkRecord(c, pack, record)) return fail();
  if (pack.commitment?.root !== record.root) {
    c.fail('claimed-root', 'the pack carries a root that differs from the chain');
    return fail();
  }
  const depth = log2Exact(record.headcount_bucket);
  if (depth === null) {
    c.fail('depth', `committed bucket ${record.headcount_bucket} is not a power of two`);
    return fail();
  }
  return pack.scope?.kind === 'full' ? verifyFull(c, pack, ctx, record) : verifySubset(c, pack, ctx, record, depth);
}

async function verifySubset(c, pack, ctx, record, depth) {
  if (pack.scope?.kind !== 'subset' || !Array.isArray(pack.lines) || pack.lines.length === 0) {
    c.fail('scope', 'a subset pack needs scope.kind "subset" and a non-empty lines array');
    return { ok: false, checks: c.items, failure: c.firstFailure };
  }
  const seen = new Set();
  let subtotal = 0;
  const lines = [];
  for (const [i, entry] of pack.lines.entries()) {
    try {
      const line = normalizeLine(entry.line);
      const leaf = await leafHash(ctx, line, saltFromHex(entry.salt));
      const hex = toHex(leaf);
      if (seen.has(hex)) throw new ValidationError('the same leaf is listed twice (double counting)');
      seen.add(hex);
      if (!Array.isArray(entry.proof) || entry.proof.length !== depth) throw new ValidationError(`proof depth ${entry.proof?.length} != ${depth}`);
      const root = await rootFromProof(leaf, entry.proof);
      if (toHex(root) !== record.root) throw new ValidationError('does not fold up to the committed root');
      if (line.period !== record.period || line.currency !== record.currency) throw new ValidationError('period or currency differs from the commitment');
      subtotal += line.amount_cents;
      lines.push(line);
    } catch (e) {
      c.fail('line', `line ${i + 1} (${entry?.line?.employee_account ?? '?'}): ${e.message}`);
      return { ok: false, checks: c.items, failure: c.firstFailure };
    }
  }
  if (!Number.isSafeInteger(subtotal)) {
    c.fail('total', 'subtotal exceeds the safe integer range');
    return { ok: false, checks: c.items, failure: c.firstFailure };
  }
  c.pass('lines', `${lines.length} lines each fold up to the committed root, no duplicates`);
  const summary = `VERIFIED SUBSET: ${lines.length} lines, subtotal ${formatAmount(subtotal)} ${record.currency} for ${record.period}, employer ${pack.employer}`;
  return {
    ok: true,
    checks: c.items,
    scope: 'subset',
    lines,
    subtotal_cents: subtotal,
    currency: record.currency,
    summary,
    not_verified: [
      `the company total (${formatAmount(record.declared_total_cents)} ${record.currency} is only the employer's declaration; the other leaves stay hidden)`,
      'that this list is complete for its selector (an employer could omit a line); only a full audit pack proves completeness',
    ],
  };
}

async function verifyFull(c, pack, ctx, record) {
  if (!Array.isArray(pack.leaves) || pack.leaves.length !== record.headcount_bucket) {
    c.fail('scope', `a full pack must list all ${record.headcount_bucket} leaves of the committed bucket, got ${pack.leaves?.length}`);
    return { ok: false, checks: c.items, failure: c.firstFailure };
  }
  const hashes = [];
  const lines = [];
  let total = 0;
  const accounts = new Set();
  try {
    for (const [i, e] of pack.leaves.entries()) {
      if (e.kind === 'line') {
        const line = normalizeLine(e.line);
        if (line.period !== record.period || line.currency !== record.currency) throw new ValidationError(`leaf ${i}: period or currency differs from the commitment`);
        if (accounts.has(line.employee_account)) throw new ValidationError(`leaf ${i}: ${line.employee_account} appears twice`);
        accounts.add(line.employee_account);
        hashes.push(await leafHash(ctx, line, saltFromHex(e.salt)));
        total += line.amount_cents;
        lines.push(line);
      } else if (e.kind === 'dummy') {
        hashes.push(await dummyLeafHash(fromHex(e.seed, 32)));
      } else {
        throw new ValidationError(`leaf ${i}: unknown kind ${e.kind}`);
      }
    }
  } catch (e) {
    c.fail('leaves', e.message);
    return { ok: false, checks: c.items, failure: c.firstFailure };
  }
  const { root } = await buildTree(hashes);
  if (toHex(root) !== record.root) {
    c.fail('root-match', `the ${hashes.length} revealed leaves rebuild root ${toHex(root).slice(0, 16)}..., not the committed ${record.root.slice(0, 16)}...`);
    return { ok: false, checks: c.items, failure: c.firstFailure };
  }
  c.pass('root-match', `all ${hashes.length} leaves rebuild the committed root: nothing is hidden in the tree`);
  if (total !== record.declared_total_cents) {
    c.fail('total', `sum of revealed lines is ${formatAmount(total)} but the employer declared ${formatAmount(record.declared_total_cents)} ${record.currency}`);
    return { ok: false, checks: c.items, failure: c.firstFailure };
  }
  c.pass('total', `sum of revealed lines equals the declared total ${formatAmount(total)} ${record.currency}`);
  return {
    ok: true,
    checks: c.items,
    scope: 'full',
    lines,
    subtotal_cents: total,
    currency: record.currency,
    padding_leaves: hashes.length - lines.length,
    summary: `VERIFIED FULL AUDIT: ${lines.length} lines (+${hashes.length - lines.length} padding leaves) rebuild the on-chain root; total ${formatAmount(total)} ${record.currency} equals the declared total, period ${record.period}, employer ${pack.employer}`,
    not_verified: ['that money was actually paid out (the commitment is the employer\'s attestation, not a settlement receipt)'],
  };
}

export { bytesEqual };
