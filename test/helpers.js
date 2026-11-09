import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeRng } from '../src/core/hash.js';
import { buildRun, commitmentOf, exportPayslips } from '../src/core/run.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SEED = 'psp-demo-seed-2026';
export const NETWORK = { name: 'sandbox', contract: 'payroll-commit.test.near' };

export async function sampleInput() {
  return JSON.parse(await readFile(path.join(ROOT, 'samples', 'payroll.sample.json'), 'utf8'));
}

export async function sampleRun(overrides = {}) {
  return buildRun(await sampleInput(), { rng: makeRng(SEED), ...overrides });
}

/** What the contract would return for a run committed as-is. */
export function recordFor(run, extra = {}) {
  return { ...commitmentOf(run), committed_at_ms: 1790000000000, revoked: false, revoked_at_ms: null, ...extra };
}

export async function sampleSetup() {
  const run = await sampleRun();
  const payslips = await exportPayslips(run, NETWORK);
  return { run, payslips, record: recordFor(run) };
}

export const clone = (x) => JSON.parse(JSON.stringify(x));
