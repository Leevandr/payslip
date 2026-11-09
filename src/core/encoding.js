// Canonical, domain-separated encoding of one payroll line, and the leaf hash built from it.
//
//   leaf = SHA-256( "PSP/v1/leaf" 0x00
//                   || vb(employer) || vb(run_id)                 <- context binding
//                   || vb(employee_account) || u64(amount_cents) || vb(currency)
//                   || vb(period) || vb(department)
//                   || vb(payout.chain) || vb(payout.asset)
//                   || salt[32] )
//
// vb(x) = u32 big-endian byte length, then the UTF-8 bytes. Every text field is restricted to a
// small ASCII character set below, so two different inputs can never normalise to the same bytes.
import { concat, utf8, varbytes, u64be, fromHex, toHex } from './bytes.js';
import { sha256 } from './hash.js';

export const FORMAT_VERSION = 1;
export const SALT_BYTES = 32;
export const LABEL_LEAF = utf8('PSP/v1/leaf\0');
export const LABEL_NODE = utf8('PSP/v1/node\0');
export const LABEL_DUMMY = utf8('PSP/v1/dummy\0');

// NEAR account id grammar (2..64 chars, lowercase alnum separated by . _ -).
const ACCOUNT = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const CURRENCY = /^[A-Z]{3}$/;
const CHAIN = /^[a-z0-9]{2,16}$/;
const ASSET = /^[A-Za-z0-9._-]{1,16}$/;
const DEPARTMENT = /^[A-Za-z0-9 ._&/-]{0,40}$/;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function must(cond, message) {
  if (!cond) throw new ValidationError(message);
}

export const checks = {
  account: (s) => typeof s === 'string' && ACCOUNT.test(s),
  runId: (s) => typeof s === 'string' && RUN_ID.test(s),
  period: (s) => typeof s === 'string' && PERIOD.test(s),
  currency: (s) => typeof s === 'string' && CURRENCY.test(s),
};

export function validateContext(ctx) {
  must(checks.account(ctx?.employer), `employer must be a NEAR account id, got ${JSON.stringify(ctx?.employer)}`);
  must(checks.runId(ctx?.run_id), `run_id must match ${RUN_ID}, got ${JSON.stringify(ctx?.run_id)}`);
  return { employer: ctx.employer, run_id: ctx.run_id };
}

/** Validate one line and return it in canonical shape (extra fields are rejected, not ignored). */
export function normalizeLine(line) {
  must(line && typeof line === 'object' && !Array.isArray(line), 'line must be an object');
  const allowed = new Set(['employee_account', 'amount_cents', 'currency', 'period', 'department', 'payout_pref']);
  for (const k of Object.keys(line)) must(allowed.has(k), `unknown field in line: ${k}`);
  must(checks.account(line.employee_account), `employee_account must be a NEAR account id, got ${JSON.stringify(line.employee_account)}`);
  must(
    Number.isSafeInteger(line.amount_cents) && line.amount_cents > 0,
    `amount_cents must be a positive integer number of cents, got ${JSON.stringify(line.amount_cents)}`,
  );
  must(checks.currency(line.currency), `currency must be a 3-letter ISO 4217 code, got ${JSON.stringify(line.currency)}`);
  must(checks.period(line.period), `period must be YYYY-MM, got ${JSON.stringify(line.period)}`);
  const department = line.department ?? '';
  must(typeof department === 'string' && DEPARTMENT.test(department), `department must match ${DEPARTMENT}`);
  const p = line.payout_pref;
  must(p && typeof p === 'object', 'payout_pref {chain, asset} is required');
  for (const k of Object.keys(p)) must(k === 'chain' || k === 'asset', `unknown field in payout_pref: ${k}`);
  must(typeof p.chain === 'string' && CHAIN.test(p.chain), `payout_pref.chain must match ${CHAIN}, got ${JSON.stringify(p.chain)}`);
  must(typeof p.asset === 'string' && ASSET.test(p.asset), `payout_pref.asset must match ${ASSET}, got ${JSON.stringify(p.asset)}`);
  return {
    employee_account: line.employee_account,
    amount_cents: line.amount_cents,
    currency: line.currency,
    period: line.period,
    department,
    payout_pref: { chain: p.chain, asset: p.asset },
  };
}

export function encodeLeafPreimage(ctx, line, salt) {
  must(salt instanceof Uint8Array && salt.length === SALT_BYTES, 'salt must be 32 bytes');
  const c = validateContext(ctx);
  const l = normalizeLine(line);
  return concat(
    LABEL_LEAF,
    varbytes(c.employer),
    varbytes(c.run_id),
    varbytes(l.employee_account),
    u64be(l.amount_cents),
    varbytes(l.currency),
    varbytes(l.period),
    varbytes(l.department),
    varbytes(l.payout_pref.chain),
    varbytes(l.payout_pref.asset),
    salt,
  );
}

export async function leafHash(ctx, line, salt) {
  return sha256(encodeLeafPreimage(ctx, line, salt));
}

/** A padding leaf. It is a hash like any other leaf, so it cannot be told apart from a real one. */
export async function dummyLeafHash(seed) {
  must(seed instanceof Uint8Array && seed.length === 32, 'dummy seed must be 32 bytes');
  return sha256(LABEL_DUMMY, seed);
}

export function saltFromHex(hex) {
  try {
    return fromHex(hex, SALT_BYTES);
  } catch {
    throw new ValidationError('salt must be 64 hex characters');
  }
}

export const saltToHex = toHex;

export function formatAmount(cents) {
  const whole = Math.trunc(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}
