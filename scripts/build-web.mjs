// Builds dist/: the static site (no framework, no bundler). Copies the page, the isomorphic core library and the
// recorded fixtures side by side, so the page runs the SAME verification code as the CLI.
import { rm, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(path.join(ROOT, 'web'), DIST, { recursive: true });
await cp(path.join(ROOT, 'src', 'core'), path.join(DIST, 'core'), { recursive: true });
await mkdir(path.join(DIST, 'intents'), { recursive: true });
for (const f of ['quote.js', 'preview.js', 'status.js']) await cp(path.join(ROOT, 'src', 'intents', f), path.join(DIST, 'intents', f));
await mkdir(path.join(DIST, 'data'), { recursive: true });
const data = [
  ['samples/payroll.sample.json', 'payroll.sample.json'],
  ['fixtures/chain/sandbox-recorded.json', 'chain.recorded.json'],
  ['fixtures/chain/testnet-recorded.json', 'chain.testnet.recorded.json'],
  ['samples/testnet/payslips/payslip-ada-lagos.testnet.json', 'testnet-ada.payslip.json'],
  ['config/networks.json', 'networks.json'],
  ['fixtures/intents/tokens.recorded.json', 'tokens.recorded.json'],
  ['fixtures/intents/quotes.recorded.json', 'quotes.recorded.json'],
  ['fixtures/intents/status.synthetic.json', 'status.synthetic.json'],
];
for (const [from, to] of data) await cp(path.join(ROOT, from), path.join(DIST, 'data', to));
console.log(`built ${path.relative(process.cwd(), DIST) || DIST}`);
