// Payslip Proof web page. No framework. Every value that comes from a dropped file is put on the page with
// textContent (never innerHTML), so a hostile payslip.json cannot inject markup.
import { makeRng } from './core/hash.js';
import { buildRun, exportPayslips, exportDisclosure, selectorFrom } from './core/run.js';
import { verifyPayslip } from './core/verify.js';
import { formatAmount } from './core/encoding.js';
import { rpcViewGetRun } from './core/rpc.js';
import { previewLines } from './intents/preview.js';
import { timelineFor, STATUSES } from './intents/status.js';

const SEED = 'psp-demo-seed-2026'; // the public sample seed, same as the CLI demo
const NS = 'http://www.w3.org/2000/svg';

/* ------------------------------------------------------------------ tiny DOM helpers */
const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

// Static, trusted icon markup only.
const ICONS = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12h10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
};
function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name];
  return t.content.firstChild;
}

const fmt = formatAmount;
const monthName = (period) => new Date(`${period}-01T00:00:00Z`).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const short = (hex, n = 10) => `${hex.slice(0, n)}…${hex.slice(-6)}`;
const when = (iso) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

function download(name, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ------------------------------------------------------------------ state */
const S = {};

async function load() {
  const get = async (f) => {
    const r = await fetch(`./data/${f}`);
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
    return r.json();
  };
  const [input, chain, tokens, quotes, status, testnet, tnAda, networks] = await Promise.all([
    get('payroll.sample.json'), get('chain.recorded.json'), get('tokens.recorded.json'), get('quotes.recorded.json'), get('status.synthetic.json'),
    get('chain.testnet.recorded.json'), get('testnet-ada.payslip.json'), get('networks.json'),
  ]);
  S.input = input;
  S.chain = chain;
  S.testnet = testnet;
  S.tnAda = tnAda;
  S.networks = networks;
  S.tokens = tokens;
  S.quotes = quotes;
  S.status = status;
  S.network = { name: chain.network, contract: chain.contract };
  S.run = await buildRun(input, { rng: makeRng(SEED) });
  S.draft = await buildRun(input, { rng: makeRng(SEED), runId: '2026-10-draft' });
  S.payslips = await exportPayslips(S.run, S.network);
  S.draftPayslips = await exportPayslips(S.draft, S.network);
  S.lines = S.run.leaves.filter((l) => l.kind === 'line').map((l) => l.line).sort((a, b) => a.employee_account.localeCompare(b.employee_account));
}

const payslipOf = (account) => S.payslips.find((p) => p.line.employee_account === account);
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ------------------------------------------------------------------ verification (same code as the CLI) */
// Sandbox payslips are checked against the recorded sandbox answer. Testnet payslips are checked LIVE against the
// public testnet RPC (read only, CORS-enabled); if that read fails the recorded testnet answer is used and labelled.
async function lookup(payslip) {
  const name = payslip?.network?.name;
  const employer = payslip?.employer;
  const runId = payslip?.run_id;
  if (name === 'testnet' && S.networks.testnet.contract) {
    const contract = S.networks.testnet.contract;
    try {
      const record = await rpcViewGetRun({ rpc: S.networks.testnet.rpc, contract, employer, runId });
      return { record, source: { live: true, network: 'testnet', contract, label: `Commitment read live, just now, from NEAR testnet through ${S.networks.testnet.rpc} (contract ${contract}).` } };
    } catch (e) {
      const record = S.testnet.runs.find((r) => r.employer === employer && r.run_id === runId) ?? null;
      return { record, source: { live: false, network: 'testnet', contract, label: `The live testnet read failed (${e.message}), so this is the recorded testnet answer from ${when(S.testnet.recorded_at)}. Not a live read.` } };
    }
  }
  const record = S.chain.runs.find((r) => r.employer === employer && r.run_id === runId) ?? null;
  return { record, source: { live: false, network: S.chain.network, contract: S.chain.contract, label: `Commitment read from a recorded answer of ${S.chain.contract} on a real local NEAR sandbox (${when(S.chain.recorded_at)}). Not a live chain read.` } };
}

async function check(payslip) {
  const { record, source } = await lookup(payslip);
  const result = await verifyPayslip(payslip, record);
  const net = payslip?.network;
  const official = S.networks[net?.name]?.contract;
  const guardOk = Boolean(official) && net?.contract === official && source.contract === official;
  const guard = {
    ok: guardOk,
    text: guardOk
      ? `contract ${net.contract} is the official ${net.name} contract`
      : `the file points at ${net?.contract ?? 'no contract'}, but the official ${net?.name ?? 'network'} contract is ${official ?? 'unknown'}`,
  };
  const checks = [guard, ...result.checks];
  const ok = result.ok && guard.ok;
  return { ok, checks, result, record, source, failure: !guard.ok ? guard : result.failure, payslip };
}

const FAIL_TITLES = {
  'root-match': ['The file does not match the commitment', 'Something in this payslip was changed, or it was never part of the committed payroll run.'],
  commitment: ['No commitment found', 'NEAR has no record for this employer and run, so there is nothing to compare against.'],
  'commitment-identity': ['The record belongs to someone else', 'The commitment on chain is not the employer and run this file claims.'],
  'not-revoked': ['The employer revoked this run', 'The employer withdrew this payroll run on chain, so its payslips no longer count.'],
  leaf: ['This is not a valid payslip', 'The file is missing fields or contains values the format does not allow.'],
  root: ['The proof is malformed', 'The sibling hashes could not be folded into a root.'],
  depth: ['The proof has the wrong length', 'The proof does not fit the tree size the employer committed.'],
  period: ['The period does not match', 'The line is for a different period than the commitment.'],
  currency: ['The currency does not match', 'The line is in a different currency than the commitment.'],
};

/* ------------------------------------------------------------------ Merkle path diagram */
function merkleDiagram(proof, bucket) {
  const depth = proof.length;
  const n = 2 ** depth;
  let idx = 0;
  proof.forEach((s, k) => { if (s.side === 'left') idx |= 1 << k; });
  const avail = Math.round(document.querySelector('#result')?.clientWidth || 640) - 34;
  const W = Math.max(300, Math.min(640, avail));
  const padX = 16;
  const rowH = W < 420 ? 44 : depth > 4 ? 40 : 52;
  const H = depth * rowH + 64;
  const x = (level, i) => {
    const span = 2 ** level;
    const first = padX + ((i * span + (span - 1) / 2) * (W - 2 * padX)) / (n - 1 || 1);
    return n === 1 ? W / 2 : first;
  };
  const y = (level) => H - 30 - level * rowH;
  const ink = 'var(--ink)';
  const g = svg('g');
  const pathIdx = (level) => idx >> level;
  // edges
  for (let level = 1; level <= depth; level++) {
    for (let i = 0; i < n / 2 ** level; i++) {
      for (const c of [2 * i, 2 * i + 1]) {
        const onPath = pathIdx(level) === i && pathIdx(level - 1) === c;
        g.append(svg('line', { x1: x(level - 1, c), y1: y(level - 1), x2: x(level, i), y2: y(level), stroke: onPath ? ink : 'var(--node-dim)', 'stroke-width': onPath ? 2.2 : 1 }));
      }
    }
  }
  // nodes
  for (let level = 0; level <= depth; level++) {
    for (let i = 0; i < n / 2 ** level; i++) {
      const onPath = pathIdx(level) === i;
      const isSibling = level < depth && (pathIdx(level) ^ 1) === i;
      const r = level === depth ? 8 : level === 0 ? (n > 16 ? 4.5 : 6) : 6;
      let attrs = { cx: x(level, i), cy: y(level), r, fill: 'var(--node-dim)', stroke: 'none' };
      if (onPath) attrs = { ...attrs, fill: level === depth ? 'var(--ok)' : ink };
      else if (isSibling) attrs = { ...attrs, fill: 'var(--surface)', stroke: ink, 'stroke-width': 1.8 };
      g.append(svg('circle', attrs));
    }
  }
  const label = (text, px, py, anchor = 'middle', weight = 600) => svg('text', { x: px, y: py, 'text-anchor': anchor, 'font-size': 12, 'font-weight': weight, fill: 'var(--ink-2)', 'font-family': 'var(--font)' }, document.createTextNode(text));
  const lx = x(0, idx);
  g.append(label('your line', lx, y(0) + 24, lx < 60 ? 'start' : lx > W - 60 ? 'end' : 'middle', 650));
  if (lx < 60) g.lastChild.setAttribute('x', lx - 6);
  g.append(label(W < 420 ? 'root: recomputed here = read from NEAR' : 'root, recomputed here and read from NEAR', W / 2, 14, 'middle', 650));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Merkle tree with ${bucket} leaves. Your leaf, the ${depth} sibling hashes you were given and the path to the root are highlighted; all other leaves stay hidden.` }, g);
  return root;
}

function legend() {
  const item = (style, text) => h('span', {}, h('i', { style }), text);
  return h('div', { class: 'legend' },
    item('background:var(--ok)', 'your leaf'),
    item('background:var(--ink)', 'path to the root'),
    item('background:var(--surface);box-shadow:inset 0 0 0 1.8px var(--ink)', 'sibling hash you were given'),
    item('background:var(--node-dim)', 'hidden: other people and padding'));
}

/* ------------------------------------------------------------------ verify view */
function checkList(checks) {
  return h('ul', { class: 'checks' }, checks.map((c) => h('li', { class: c.ok ? 'y' : 'n' }, icon(c.ok ? 'check' : 'cross'), h('span', { text: c.text }))));
}

function sourceRow(source) {
  return h('div', { class: 'src' },
    h('span', { class: `tag ${source.live ? 'ok' : 'warn'}`, text: source.live ? 'Live' : 'Recorded' }),
    h('span', { text: source.label }));
}

async function renderResult(outcome) {
  const box = $('#result');
  box.replaceChildren();
  if (!outcome) {
    box.append(h('div', { class: 'empty' }, h('strong', { text: 'No payslip loaded yet' }), h('span', { text: 'Drop a file on the left, or pick an example to see a green and a red result.' })));
    return;
  }
  const { ok, checks, result, payslip } = outcome;
  if (ok) {
    const line = result.line;
    box.append(
      h('div', { class: 'banner ok' },
        h('div', { class: 'badge' }, icon('check')),
        h('div', {},
          h('div', { class: 'kicker', text: 'Verified' }),
          h('div', { class: 'big' }, `${fmt(line.amount_cents)}`, h('small', { text: line.currency })),
          h('div', { class: 'sub' }, `for ${monthName(line.period)}, paid by `, h('b', { text: payslip.employer })))),
      h('div', { class: 'panel' }, h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('b', { text: '1' }), h('span', { text: 'pay line disclosed: yours' })),
        h('div', { class: 'fact' }, h('b', { text: String(payslip.proof.length) }), h('span', { text: 'sibling hashes, no amounts or names' })),
        h('div', { class: 'fact' }, h('b', { text: String(outcome.record.headcount_bucket - 1) }), h('span', { text: 'other leaves, all hidden' })))),
      h('div', { class: 'card panel diagram' }, merkleDiagram(payslip.proof, outcome.record.headcount_bucket), legend(),
        h('p', { class: 'cap', text: 'The verifier folds your leaf up the highlighted path. It only ever sees the ringed hashes, so it learns nothing about the grey leaves.' })),
      h('div', { class: 'card panel' }, h('h3', { class: 'card-title', text: 'Checks' }), checkList(checks)),
      h('div', { class: 'panel callout' }, h('b', { text: 'What this does not prove' }),
        h('ul', {},
          h('li', { text: 'That the money arrived. The commitment is the employer’s attestation on chain, not a settlement receipt.' }),
          h('li', {}, 'That ', h('b', { text: payslip.employer }), ' really is the employer you think it is. Check that account with the employer, out of band.'))),
      sourceRow(outcome.source),
    );
    return;
  }
  const [title, body] = FAIL_TITLES[outcome.failure?.id] ?? ['Not verified', 'The checks below say which one failed.'];
  const guardFail = outcome.failure === checks[0] && !checks[0].ok;
  box.append(
    h('div', { class: 'banner bad' },
      h('div', { class: 'badge' }, icon('cross')),
      h('div', {},
        h('div', { class: 'kicker', text: 'Not verified' }),
        h('div', { class: 'big', style: 'font-size:clamp(22px,3.4vw,30px)', text: guardFail ? 'Unofficial contract' : title }),
        h('div', { class: 'sub', text: guardFail ? 'The file points at a contract this page does not trust.' : body }))),
    h('div', { class: 'card panel' }, h('h3', { class: 'card-title', text: 'What the verifier found' }), checkList(checks)),
    h('div', { class: 'panel callout' }, h('b', { text: 'Do not rely on this payslip.' }), h('ul', {}, h('li', { text: 'A red result is final for this file. Ask the employee to request a fresh payslip from the employer.' }))),
    outcome.source ? sourceRow(outcome.source) : null,
  );
}

function exampleDefs() {
  const ada = payslipOf('ada-lagos.testnet');
  const adaDraft = S.draftPayslips.find((p) => p.line.employee_account === 'ada-lagos.testnet');
  return [
    { id: 'ada', title: 'Ada’s payslip', note: 'October 2026, exactly as the employer issued it', tag: ['ok', 'verifies'], file: () => clone(ada) },
    { id: 'tamper', title: 'Amount raised to 9,800.00', note: 'Same file, one number edited by the employee', tag: ['bad', 'fails'], file: () => { const p = clone(ada); p.line.amount_cents = 980000; return p; } },
    { id: 'sibling', title: 'A sibling hash swapped', note: 'Proof path no longer folds into the root', tag: ['bad', 'fails'], file: () => { const p = clone(ada); p.proof[1].hash = 'ab'.repeat(32); return p; } },
    { id: 'employer', title: 'A different employer named', note: 'Payslip claims it came from other-payroll.test.near', tag: ['bad', 'fails'], file: () => { const p = clone(ada); p.employer = 'other-payroll.test.near'; return p; } },
    { id: 'revoked', title: 'Payslip from a revoked run', note: 'The employer committed this run, then revoked it', tag: ['bad', 'fails'], file: () => clone(adaDraft) },
    { id: 'testnet', title: 'Live: Ada’s payslip on NEAR testnet', note: 'Reads the commitment from the public testnet right now', tag: ['ok', 'verifies'], file: () => clone(S.tnAda) },
    { id: 'testnet-tamper', title: 'Live: same testnet payslip, amount raised', note: 'The real chain says no', tag: ['bad', 'fails'], file: () => { const p = clone(S.tnAda); p.line.amount_cents = 980000; return p; } },
  ];
}

function renderExamples(activeId) {
  const wrap = $('#examples');
  wrap.replaceChildren(...exampleDefs().map((ex) => h('button', { class: 'ex', type: 'button', 'aria-pressed': ex.id === activeId ? 'true' : 'false', onclick: () => openVerify(ex.id, { scroll: true }) },
    h('span', { class: 't' }, h('b', { text: ex.title }), h('i', { text: ex.note })),
    h('span', { class: `tag ${ex.tag[0]}`, text: ex.tag[1] }))));
}

function revealResult() {
  if (matchMedia('(max-width: 899px)').matches) $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function openVerify(id, { scroll = false } = {}) {
  const ex = exampleDefs().find((e) => e.id === id) ?? (S.payslips.some((p) => p.line.employee_account === id) ? { id, file: () => clone(payslipOf(id)) } : null);
  if (!ex) return;
  renderExamples(ex.id);
  await renderResult(await check(ex.file()));
  if (scroll) revealResult();
}

async function handleFile(file) {
  renderExamples(null);
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    await renderResult({ ok: false, checks: [{ ok: false, text: `${file.name} is not valid JSON` }], failure: { id: 'leaf' }, payslip: {} });
    return;
  }
  await renderResult(await check(parsed));
}

function wireDrop() {
  const drop = $('#drop');
  const input = $('#file');
  input.addEventListener('change', () => input.files[0] && handleFile(input.files[0]));
  ['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (ev) => ev.dataTransfer.files[0] && handleFile(ev.dataTransfer.files[0]));
  drop.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); } });
}

/* ------------------------------------------------------------------ employer view */
async function renderEmployer() {
  const root = $('#employer');
  root.replaceChildren();
  const run = S.run;
  const rec = S.chain.runs.find((r) => r.run_id === run.run_id);
  const real = S.lines.length;
  const matches = rec && rec.root === run.root;
  const tx = S.chain.transactions.find((t) => t.run_id === run.run_id && t.action === 'commit_run');

  root.append(
    h('div', { class: 'metrics' },
      h('div', { class: 'metric' }, h('div', { class: 'k', text: 'Run' }), h('div', { class: 'v', text: run.run_id }), h('div', { class: 'd', text: `${monthName(run.period)} · ${run.employer}` })),
      h('div', { class: 'metric' }, h('div', { class: 'k', text: 'Pay lines' }), h('div', { class: 'v', text: String(real) }), h('div', { class: 'd', text: `hidden among ${run.headcount_bucket} leaves (${run.headcount_bucket - real} random padding)` })),
      h('div', { class: 'metric' }, h('div', { class: 'k', text: 'Declared total' }), h('div', { class: 'v' }, fmt(run.declared_total_cents), h('span', { class: 'muted', style: 'font-size:0.55em;font-weight:600;margin-left:6px', text: run.currency })), h('div', { class: 'd', text: 'public on chain, the one number that is revealed' })),
      h('div', { class: 'metric' }, h('div', { class: 'k', text: 'On NEAR' }), h('div', { class: 'v', style: matches ? 'color:var(--ok)' : 'color:var(--bad)', text: matches ? 'Committed' : 'Mismatch' }), h('div', { class: 'd', text: matches ? 'root rebuilt here equals the recorded on-chain root' : 'root differs from the record' }))),
  );

  const rows = S.lines.map((l) => h('tr', {},
    h('td', {}, h('div', { class: 'acct', text: l.employee_account }), h('div', { class: 'dept', text: l.department })),
    h('td', { class: 'r num', text: fmt(l.amount_cents) }),
    h('td', { class: 'dept nw', text: `${l.payout_pref.asset} on ${l.payout_pref.chain}` }),
    h('td', { class: 'r' }, h('div', { class: 'rowbtns' },
      h('a', { class: 'btn sm', href: `#verify/${l.employee_account}`, text: 'Check' }),
      h('button', { class: 'btn sm', type: 'button', title: 'Download this employee’s payslip.json', onclick: () => download(`payslip-${l.employee_account}.json`, payslipOf(l.employee_account)) }, icon('down'), 'JSON')))));
  rows.forEach((r) => { const svgEl = r.querySelector('svg'); if (svgEl) { svgEl.style.width = '14px'; svgEl.style.height = '14px'; } });

  const left = h('div', { class: 'card' },
    h('h3', { class: 'card-title', text: 'Payroll run (private to the employer)' }),
    h('p', { class: 'muted small', style: 'margin:0 0 10px', text: 'Only this screen knows who earns what. Each row becomes one salted leaf in the tree.' }),
    h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: 'Employee' }), h('th', { class: 'r', text: `Pay (${run.currency})` }), h('th', { text: 'Paid as' }), h('th', {}))),
      h('tbody', {}, rows))));

  const right = h('div', { class: 'stackY' },
    h('div', { class: 'card' },
      h('h3', { class: 'card-title', text: 'What is on NEAR' }),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Contract' }), h('dd', { class: 'mono', text: S.chain.contract }),
        h('dt', { text: 'Employer' }), h('dd', { class: 'mono', text: rec.employer }),
        h('dt', { text: 'Period' }), h('dd', { text: rec.period }),
        h('dt', { text: 'Headcount bucket' }), h('dd', { text: `${rec.headcount_bucket} (9 to 16 people)` }),
        h('dt', { text: 'Declared total' }), h('dd', { class: 'num', text: `${fmt(Number(rec.declared_total_cents))} ${rec.currency}` }),
        h('dt', { text: 'Committed' }), h('dd', { text: when(Number(rec.committed_at_ms)) }),
        h('dt', { text: 'Revoked' }), h('dd', { text: rec.revoked ? 'yes' : 'no' })),
      h('span', { class: 'hash', text: rec.root }),
      h('div', { class: 'src' }, h('span', { class: 'tag warn', text: 'Recorded' }), h('span', { text: `From a real local NEAR sandbox run on ${when(S.chain.recorded_at)}${tx ? `, transaction ${short(tx.hash, 8)}` : ''}.` })),
      S.networks.testnet.contract ? h('p', { class: 'muted small', style: 'margin:14px 0 0' }, 'The same run is also committed on NEAR testnet, contract ', h('span', { class: 'mono', text: S.networks.testnet.contract }), ' (', ...S.testnet.transactions.filter((t) => t.action === 'commit_run').map((t) => h('a', { href: t.explorer, target: '_blank', rel: 'noopener', text: 'commit transaction' })), '). Check it live in the Verify tab.') : null,
      h('div', { class: 'two' },
        h('div', { class: 'col' }, h('h4', { text: 'Public' }), h('ul', {}, h('li', { text: 'the root hash' }), h('li', { text: 'period, currency' }), h('li', { text: 'declared total' }), h('li', { text: 'headcount bucket, not the headcount' }), h('li', { text: 'employer account' }))),
        h('div', { class: 'col' }, h('h4', { text: 'Never on chain' }), h('ul', {}, h('li', { text: 'names or accounts of staff' }), h('li', { text: 'any individual amount' }), h('li', { text: 'salts' }), h('li', { text: 'how many leaves are padding' }))))),
    h('div', { class: 'card' },
      h('h3', { class: 'card-title', text: 'Auditor packs' }),
      h('p', { class: 'muted small', style: 'margin:0', text: 'A subset pack shows chosen lines and proves each is in the commitment. A full-company total can only be checked by revealing every line.' }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: async () => download('engineering.disclosure.json', await exportDisclosure(run, { ...selectorFrom({ department: 'Engineering' }), network: S.network })) }, icon('down'), 'Engineering only'),
        h('button', { class: 'btn', type: 'button', onclick: async () => download('full-audit.disclosure.json', await exportDisclosure(run, { full: true, network: S.network })) }, icon('down'), 'Full audit pack')),
      h('p', { class: 'muted small', style: 'margin:12px 0 0' }, 'Verify a pack with ', h('span', { class: 'mono', text: 'npm run psp -- verify-disclosure FILE' }), '.')));
  right.querySelectorAll('.btn svg').forEach((s) => { s.style.width = '15px'; s.style.height = '15px'; });
  root.append(h('div', { class: 'grid-2' }, left, right));
}

/* ------------------------------------------------------------------ payouts view */
async function renderPayouts(selectedStatus) {
  const root = $('#payouts');
  root.replaceChildren();
  const byKey = new Map(S.quotes.quotes.map((q) => [q.key, q]));
  const lines = S.lines.map((l) => ({ ...l }));
  const cards = await previewLines(lines, S.tokens.tokens, async (key) => byKey.get(key));
  const recordedAt = S.quotes.recorded_at;

  root.append(h('div', { class: 'notice' }, h('span', { class: 'tag warn', text: 'Recorded' }),
    h('div', {}, h('b', { text: 'Dry-run quotes only. ' }), `These are real answers from the NEAR Intents 1Click API, recorded ${when(recordedAt)}, with dry:true: no deposit address exists and nothing is sent. A quote is valid for 10 minutes, so before a real payout the app would ask again; run `, h('span', { class: 'mono wrapany', text: 'npm run psp -- payout-preview --live' }), ' to price them now.')));

  const grid = h('div', { class: 'cards' });
  const eta = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s` : `${sec}s`);
  for (const c of cards) {
    const expired = c.state === 'expired';
    const chip = c.state === 'unavailable' ? h('span', { class: 'tag bad', text: 'No quote' }) : h('span', { class: `tag ${expired ? 'neutral' : 'ok'}`, text: expired ? 'Recorded · expired' : 'Recorded · valid' });
    grid.append(h('article', { class: 'pay' },
      h('div', { class: 'pay-top' }, h('div', {}, h('b', { text: c.employee_account }), h('div', { class: 'sub', text: c.department })), chip),
      h('div', { class: 'route' },
        h('div', { class: 'from', text: `${fmt(c.amount_cents)} ${c.currency} paid from USDC on NEAR` }),
        c.state === 'unavailable'
          ? h('div', { class: 'from', text: c.reason })
          : h('div', { class: 'to' }, Number(c.receive.amount).toLocaleString('en-US', { maximumFractionDigits: 6 }), h('small', { text: `${c.pref.asset} on ${c.pref.chain}` }))),
      c.state === 'unavailable' ? null : h('div', { class: 'pay-foot' },
        h('span', {}, 'cost ', h('b', { text: `${c.cost_pct.toFixed(2)}%` })),
        h('span', {}, 'arrives in ', h('b', { text: eta(c.eta_seconds) })))));
  }
  root.append(grid);

  const statuses = S.status.examples;
  const current = STATUSES.includes(selectedStatus) ? selectedStatus : 'REFUNDED';
  const tlCard = h('div', { class: 'card timeline-card' });
  const draw = (status) => {
    const t = timelineFor(status);
    const ex = statuses.find((e) => e.status === status);
    tlCard.replaceChildren(
      h('h3', { class: 'card-title', text: 'After the employer pays: the status timeline' }),
      h('p', { class: 'muted small', style: 'margin:0', text: 'Every outcome a payout can have, including the ones where money comes back. Pick one.' }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Status example' }, STATUSES.map((s) => h('button', { type: 'button', 'aria-pressed': s === status ? 'true' : 'false', onclick: () => { history.replaceState(null, '', `#payouts/${s}`); draw(s); } }, s))),
      h('div', { class: 'tl' }, t.steps.map((st) => h('div', { class: `st ${st.state}` },
        h('div', { class: 'dot' }, st.state === 'done' ? icon('check') : st.state === 'failed' ? icon('cross') : st.state === 'skipped' ? icon('minus') : null),
        h('div', { class: 'lab', text: st.label })))),
      h('div', { class: `tl-note ${t.tone}` }, h('b', { text: t.headline }), h('div', { text: t.next }), ex?.note ? h('div', { class: 'muted', style: 'margin-top:6px', text: `In this example: ${ex.note}${ex.swapDetails?.refundReason ? ` (reason code ${ex.swapDetails.refundReason})` : ''}` }) : null),
      h('div', { class: 'src' }, h('span', { class: 'tag neutral', text: 'Synthetic' }), h('span', { text: 'Shaped after the 1Click status schema. A real status needs a real deposit, which this project never makes.' })));
    tlCard.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', b.textContent === status ? 'true' : 'false'));
  };
  draw(current);
  root.append(tlCard);
}

/* ------------------------------------------------------------------ routing and theme */
const VIEWS = ['verify', 'employer', 'payouts'];

async function route() {
  const [name = 'verify', arg] = location.hash.replace(/^#\/?/, '').split('/');
  const view = VIEWS.includes(name) ? name : 'verify';
  document.body.dataset.route = view;
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (!S.run) return;
  if (view === 'verify') {
    if (arg) await openVerify(decodeURIComponent(arg));
    else if (!$('#result').firstChild) { renderExamples(null); await renderResult(null); }
  } else if (view === 'employer') {
    await renderEmployer();
  } else {
    await renderPayouts(arg ? decodeURIComponent(arg) : undefined);
  }
}

function wireTheme() {
  const root = document.documentElement;
  try { const saved = localStorage.getItem('psp-theme'); if (saved) root.dataset.theme = saved; } catch { /* storage blocked: fine */ }
  const forced = new URLSearchParams(location.search).get('theme');
  if (forced === 'dark' || forced === 'light') root.dataset.theme = forced;
  $('#theme').addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('psp-theme', root.dataset.theme); } catch { /* ignore */ }
  });
}

async function boot() {
  wireTheme();
  wireDrop();
  try {
    await load();
  } catch (e) {
    const box = $('#boot-error');
    box.hidden = false;
    box.append(h('div', { class: 'callout' }, h('b', { text: 'The page could not load its data. ' }), `${e.message}. Serve it over http, for example with `, h('span', { class: 'mono', text: 'npm run web' }), ', instead of opening the file directly.'));
    return;
  }
  addEventListener('hashchange', route);
  await route();
  document.documentElement.dataset.ready = 'true';
}

boot();
