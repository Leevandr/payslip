// npm run demo : the whole story offline, in about two seconds. No env vars, no network, no install.
// It runs the real CLI. Chain reads come from RECORDED answers of a real local NEAR sandbox (labelled as such).
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, cli, heading, say } from './demo-lib.mjs';

const OUT = path.join(ROOT, 'out', 'demo');
const SEED = 'psp-demo-seed-2026';
await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, 'tamper'), { recursive: true });
const rel = (p) => path.relative(ROOT, p);
const ada = path.join(OUT, 'payslips', 'payslip-ada-lagos.testnet.json');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const writeJson = (p, v) => writeFile(p, `${JSON.stringify(v, null, 2)}\n`);

heading('1. The employer builds October payroll for 11 fictional people');
say('Salts are fixed by --seed so this sample reproduces byte for byte. Real runs omit --seed and use random salts.');
await cli(['build-run', '--input', 'samples/payroll.sample.json', '--out', rel(path.join(OUT, 'run')), '--seed', SEED]);

heading('2. One payslip file per employee');
await cli(['export-payslips', '--run', rel(path.join(OUT, 'run', 'run.private.json')), '--out', rel(path.join(OUT, 'payslips')), '--network', 'sandbox']);
const ps = await readJson(ada);
say(`Ada's file holds only her own line, her salt and ${ps.proof.length} sibling hashes: ${Object.keys(ps).join(', ')}.`);

heading('3. Ada hands the file to a landlord, who verifies it against the chain');
await cli(['verify-payslip', rel(ada)]);

heading('4. Tamper tests: each of these must FAIL');
const tamper = async (name, edit, extra = []) => {
  const p = await readJson(ada);
  edit(p);
  const file = path.join(OUT, 'tamper', `${name}.json`);
  await writeJson(file, p);
  say(`\n-- ${name}`);
  await cli(['verify-payslip', rel(file), '--brief', ...extra], { expect: 1 });
};
await tamper('amount-raised-from-5800-to-9800', (p) => { p.line.amount_cents = 980000; });
await tamper('wrong-sibling-hash', (p) => { p.proof[1].hash = 'ab'.repeat(32); });
await tamper('wrong-employer', (p) => { p.employer = 'other-payroll.test.near'; });

say('\n-- revoked run: the employer built a draft run, committed it, then revoked it (recorded from a real sandbox)');
await cli(['build-run', '--input', 'samples/payroll.sample.json', '--out', rel(path.join(OUT, 'draft')), '--run-id', '2026-10-draft', '--seed', SEED], { show: false });
await cli(['export-payslips', '--run', rel(path.join(OUT, 'draft', 'run.private.json')), '--out', rel(path.join(OUT, 'draft-payslips')), '--network', 'sandbox'], { show: false });
await cli(['verify-payslip', rel(path.join(OUT, 'draft-payslips', 'payslip-ada-lagos.testnet.json')), '--brief'], { expect: 1 });

heading('5. An auditor gets a disclosure pack for ONE department (Engineering), nobody else');
const run = rel(path.join(OUT, 'run', 'run.private.json'));
const subset = rel(path.join(OUT, 'engineering.disclosure.json'));
await cli(['export-disclosure', '--run', run, '--department', 'Engineering', '--out', subset, '--network', 'sandbox']);
await cli(['verify-disclosure', subset]);

heading('6. A full-company total can only be checked by revealing every line to the auditor');
const full = rel(path.join(OUT, 'full-audit.disclosure.json'));
await cli(['export-disclosure', '--run', run, '--all', '--out', full, '--network', 'sandbox']);
await cli(['verify-disclosure', full]);

heading('7. What would each person receive in the asset and chain they prefer?');
await cli(['payout-preview', '--run', run]);

console.log('\nDemo finished: every expected success succeeded and every tamper attempt failed.');
console.log('Next: npm run demo:chain runs the same flow against a live local NEAR sandbox (needs `npm ci`).');
