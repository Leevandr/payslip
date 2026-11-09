// npm run demo:testnet : READ-ONLY verification against the real NEAR TESTNET deployment of payroll-commit.
// No key, no account, no funds, nothing is written. Needs outbound HTTPS to https://test.rpc.fastnear.com.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, cli, heading, say } from './demo-lib.mjs';

const OUT = path.join(ROOT, 'out', 'demo-testnet');
await mkdir(OUT, { recursive: true });
const fx = JSON.parse(await readFile(path.join(ROOT, 'fixtures', 'chain', 'testnet-recorded.json'), 'utf8'));
const ada = 'samples/testnet/payslips/payslip-ada-lagos.testnet.json';

heading(`1. Verify Ada's payslip against the live testnet contract ${fx.contract}`);
await cli(['verify-payslip', ada, '--chain', 'testnet']);

heading('2. Change the amount: the live check must fail');
const p = JSON.parse(await readFile(path.join(ROOT, ada), 'utf8'));
p.line.amount_cents = 980000;
const bad = path.join(OUT, 'amount-9800.json');
await writeFile(bad, JSON.stringify(p));
await cli(['verify-payslip', path.relative(ROOT, bad), '--chain', 'testnet', '--brief'], { expect: 1 });

heading('3. An auditor checks the Engineering department pack against the same live commitment');
await cli(['verify-disclosure', 'samples/testnet/engineering.disclosure.json', '--chain', 'testnet']);

heading('4. The full-company audit pack: every line revealed, total compared with the declared total');
await cli(['verify-disclosure', 'samples/testnet/full-audit.disclosure.json', '--chain', 'testnet']);

say('\nOn-chain evidence (open in a browser):');
for (const t of fx.transactions) say(`  ${t.action.padEnd(10)} ${t.explorer}`);
console.log('\nTestnet demo finished. Everything above was read live from NEAR testnet.');
