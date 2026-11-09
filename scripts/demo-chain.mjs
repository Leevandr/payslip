// npm run demo:chain : the same story against a LIVE local NEAR sandbox (real nearcore, the real contract wasm).
// Needs `npm ci` (one dependency, near-kit). First run downloads the NEAR sandbox binary. Nothing leaves this machine.
import { spawn } from 'node:child_process';
import { rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, CLI, cli, heading, say } from './demo-lib.mjs';

const OUT = path.join(ROOT, 'out', 'demo-chain');
const SEED = 'psp-demo-seed-2026';
const rel = (p) => path.relative(ROOT, p);
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

heading('0. Start a local NEAR chain and deploy the payroll-commit contract on it');
const chain = spawn(process.execPath, [CLI, 'sandbox'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
const ready = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`sandbox did not start in 180 s:\n${log}`)), 180000);
  const onData = (d) => { log += d; if (log.includes('READY')) { clearTimeout(t); resolve(); } };
  chain.stdout.on('data', onData);
  chain.stderr.on('data', onData);
  chain.on('exit', (c) => { clearTimeout(t); reject(new Error(`sandbox exited early (${c}):\n${log}`)); });
});
const stop = async () => { chain.removeAllListeners('exit'); chain.kill('SIGINT'); await new Promise((r) => { chain.on('exit', r); setTimeout(r, 5000); }); };
try {
  await ready;
  process.stdout.write(log);
  const runFile = rel(path.join(OUT, 'run', 'run.private.json'));
  const ada = rel(path.join(OUT, 'payslips', 'payslip-ada-lagos.testnet.json'));

  heading('1. Build the run, export payslips, commit the root on chain');
  await cli(['build-run', '--input', 'samples/payroll.sample.json', '--out', rel(path.join(OUT, 'run')), '--seed', SEED]);
  await cli(['export-payslips', '--run', runFile, '--out', rel(path.join(OUT, 'payslips')), '--network', 'sandbox'], { show: false });
  await cli(['commit', '--run', runFile, '--network', 'sandbox']);

  heading('2. A landlord verifies the payslip: this time the commitment is read LIVE from the chain');
  await cli(['verify-payslip', ada]);

  heading('3. Tamper test against the live chain');
  const p = JSON.parse(await readFile(ada, 'utf8'));
  p.line.amount_cents = 980000;
  const bad = rel(path.join(OUT, 'tampered.json'));
  await writeFile(bad, JSON.stringify(p));
  await cli(['verify-payslip', bad, '--brief'], { expect: 1 });

  heading('4. The employer revokes the run: the same payslip now fails');
  await cli(['revoke', '--run', runFile, '--network', 'sandbox']);
  await cli(['verify-payslip', ada, '--brief'], { expect: 1 });

  heading('5. The contract refuses an overwrite of a committed run id');
  say('Committing the same run again (even revoked) must fail: commitments are immutable, corrections get a new run id.');
  await cli(['commit', '--run', runFile, '--network', 'sandbox'], { expect: 3 });
  console.log('\nLive chain demo finished.');
} finally {
  await stop();
}
