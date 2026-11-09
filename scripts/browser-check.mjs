// Optional end-to-end check of the web page in a real headless Chromium, driven over the DevTools protocol
// (Node 22 has a global WebSocket, so there is no dependency). It uploads real files into the page's file input.
//   CHROME=/path/to/chrome npm run test:browser
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, cli } from './demo-lib.mjs';

const CHROME = process.env.CHROME;
if (!CHROME) { console.error('set CHROME to a Chromium/Chrome binary, e.g. CHROME=$(which chromium)'); process.exit(2); }
const dir = await mkdtemp(path.join(tmpdir(), 'psp-browser-'));
const PORT = 5199; const DEBUG = 9333;
const procs = [];
const cleanup = async () => { for (const p of procs) p.kill('SIGKILL'); await rm(dir, { recursive: true, force: true }); };
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };

try {
  // payslips to upload
  await cli(['build-run', '--input', 'samples/payroll.sample.json', '--out', path.join(dir, 'run'), '--seed', 'psp-demo-seed-2026'], { show: false });
  await cli(['export-payslips', '--run', path.join(dir, 'run', 'run.private.json'), '--out', path.join(dir, 'ps'), '--network', 'sandbox'], { show: false });
  const good = path.join(dir, 'ps', 'payslip-ada-lagos.testnet.json');
  const goodJson = JSON.parse(await (await import('node:fs/promises')).readFile(good, 'utf8'));
  const tampered = path.join(dir, 'tampered.json');
  await writeFile(tampered, JSON.stringify({ ...goodJson, line: { ...goodJson.line, amount_cents: 999999 } }));
  const hostile = path.join(dir, 'hostile.json');
  await writeFile(hostile, JSON.stringify({ ...goodJson, employer: '<img src=x onerror="document.title=\'pwned\'">' }));
  const notJson = path.join(dir, 'notjson.json');
  await writeFile(notJson, 'this is not json');

  const server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  procs.push(server);
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${path.join(dir, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
  procs.push(chrome);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json(); if (targets.length) break; } catch { /* not up yet */ }
    await sleep(200);
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const waitFor = async (expression, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evaluate(expression)) return true; await sleep(100); } return false; };
  const upload = async (file) => {
    await evaluate("document.querySelector('#result').replaceChildren()");
    const doc = await send('DOM.getDocument', { depth: 1 });
    const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#file' });
    await send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [file] });
    return waitFor("!!document.querySelector('#result .banner')");
  };

  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#verify` });
  ok(await waitFor("document.documentElement.dataset.ready === 'true'", 15000), 'page boots and loads its recorded data');

  ok(await upload(good), 'uploading the real payslip produces a result');
  ok(await evaluate("!!document.querySelector('#result .banner.ok')"), 'genuine payslip: green banner');
  ok((await evaluate("document.querySelector('#result .banner .big').textContent")).includes('5,800.00'), 'genuine payslip: shows 5,800.00');
  ok(await evaluate("document.querySelectorAll('#result .checks li.y').length >= 8"), 'genuine payslip: all checks listed as passed');

  ok(await upload(tampered), 'uploading the tampered payslip produces a result');
  ok(await evaluate("!!document.querySelector('#result .banner.bad') && !document.querySelector('#result .banner.ok')"), 'tampered payslip: red banner, no green');

  ok(await upload(notJson), 'uploading a non-JSON file produces a result');
  ok(await evaluate("!!document.querySelector('#result .banner.bad')"), 'non-JSON file: red banner, no crash');

  ok(await upload(hostile), 'uploading a payslip with HTML in a field produces a result');
  ok(await evaluate("!document.querySelector('#result img') && document.title === 'Payslip Proof'"), 'hostile field is shown as text, nothing is injected or executed');

  // example buttons and the other two views
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#verify/revoked` });
  ok(await waitFor("!!document.querySelector('#result .banner.bad')"), 'revoked example: red');
  ok(await evaluate("document.querySelector('#result').textContent.includes('revoked')"), 'revoked example says the employer revoked the run');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#verify/testnet` });
  ok(await waitFor("!!document.querySelector('#result .banner.ok')", 20000), 'testnet example: green');
  const src = await evaluate("document.querySelector('#result .src').textContent");
  ok(/testnet/.test(src), `testnet example names its source (${src.slice(0, 60)}...)`);
  ok(await evaluate("document.querySelector('#result .src .tag').textContent") === 'Live' || /failed/.test(src), 'testnet example is labelled Live (or says the live read failed)');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#verify/testnet-tamper` });
  ok(await waitFor("!!document.querySelector('#result .banner.bad')", 20000), 'tampered testnet payslip: red');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#employer` });
  ok(await waitFor("document.querySelectorAll('#employer tbody tr').length === 11"), 'employer view lists the 11 pay lines');
  ok(await evaluate("document.querySelector('#employer .metric:nth-child(4)').textContent.includes('Committed')"), 'employer view: root rebuilt in the browser equals the recorded on-chain root');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#payouts/REFUNDED` });
  ok(await waitFor("document.querySelectorAll('#payouts .pay').length === 11"), 'payouts view shows 11 priced cards');
  ok(await evaluate("document.querySelector('#payouts .tl-note').textContent.includes('Refunded')"), 'status timeline shows the REFUNDED state');
  ws.close();
} finally {
  await cleanup();
}
console.log(failures ? `\n${failures} browser check(s) FAILED` : '\nall browser checks passed');
process.exit(failures ? 1 : 0);
