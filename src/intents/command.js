// payout-preview: what would each person receive in the asset and chain they prefer?
// Default = RECORDED dry quotes from fixtures/intents. --live = fresh dry quotes (still dry:true, still nothing sent).
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { ROOT } from '../chain/sources.js';
import { formatAmount } from '../core/encoding.js';
import { fetchTokens, fetchDryQuote, API } from './quote.js';
import { previewLines } from './preview.js';
import { readJson, bold, dim, yellow, green, UsageError } from '../cli/io.js';

const DIR = path.join(ROOT, 'fixtures', 'intents');

export async function loadRecorded() {
  const tokens = JSON.parse(await readFile(path.join(DIR, 'tokens.recorded.json'), 'utf8'));
  const quotes = JSON.parse(await readFile(path.join(DIR, 'quotes.recorded.json'), 'utf8'));
  return { tokens, quotes };
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

export async function payoutPreviewCommand(args) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { run: { type: 'string' }, live: { type: 'boolean', default: false }, json: { type: 'boolean', default: false } }, strict: true }));
  } catch (e) {
    throw new UsageError(e.message);
  }
  if (!values.run) throw new UsageError('missing --run');
  const run = await readJson(values.run);
  const lines = run.leaves.filter((l) => l.kind === 'line').map((l) => l.line).sort((a, b) => a.employee_account.localeCompare(b.employee_account));

  let tokens; let getQuote; let label;
  const unreachable = (e) => new UsageError(`cannot reach the 1Click API (${e.cause?.code ?? e.message}); drop --live to use the recorded quotes`);
  if (values.live) {
    try {
      tokens = await fetchTokens();
    } catch (e) {
      throw unreachable(e);
    }
    getQuote = async (_key, request) => {
      let r;
      try {
        r = await fetchDryQuote(request);
      } catch (e) {
        throw unreachable(e);
      }
      await new Promise((res) => setTimeout(res, 300));
      return { ...r, recorded_at: new Date().toISOString(), live: true };
    };
    label = `dry-run quotes from ${API}, fetched just now. Amounts (not names) were sent to that API.`;
  } else {
    const rec = await loadRecorded();
    tokens = rec.tokens.tokens;
    const byKey = new Map(rec.quotes.quotes.map((q) => [q.key, q]));
    getQuote = async (key) => byKey.get(key);
    label = `dry-run quotes recorded ${rec.quotes.recorded_at} (fixtures/intents). Not live prices.`;
  }
  const cards = await previewLines(lines, tokens, getQuote);

  if (values.json) {
    console.log(JSON.stringify({ source: label, cards }, null, 2));
    return 0;
  }
  console.log(`${bold('Payout preview')} for run ${run.run_id} (${run.employer}), period ${run.period}`);
  console.log(`${values.live ? green('LIVE') : yellow('RECORDED')}  ${label}`);
  console.log(dim(`Funding asset: USDC on NEAR, converted by NEAR Intents 1Click. DRY RUN ONLY: no deposit address exists, nothing is sent.`));
  if (!values.live) console.log(dim('A quote is valid for 10 minutes, so recorded ones are a snapshot, not an offer. Run with --live to price them again.'));
  console.log('');
  console.log(`${pad('employee', 24)}${padL('pay (USD)', 12)}  ${pad('prefers', 14)}${padL('would receive', 24)}${padL('cost', 8)}${padL('ETA', 7)}  quote`);
  for (const c of cards) {
    const prefers = `${c.pref.asset} on ${c.pref.chain}`;
    if (c.state === 'unavailable') {
      console.log(`${pad(c.employee_account, 24)}${padL(formatAmount(c.amount_cents), 12)}  ${pad(prefers, 14)}  unavailable: ${c.reason}`);
      continue;
    }
    const rx = `${Number(c.receive.amount).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${c.pref.asset}`;
    const cost = c.cost_pct === null ? '' : `${c.cost_pct.toFixed(2)}%`;
    console.log(`${pad(c.employee_account, 24)}${padL(formatAmount(c.amount_cents), 12)}  ${pad(prefers, 14)}${padL(rx, 24)}${padL(cost, 8)}${padL(`${c.eta_seconds ?? '?'} s`, 7)}  ${c.state}`);
  }
  const unavailable = cards.filter((c) => c.state === 'unavailable').length;
  console.log(dim(`\n${cards.length - unavailable} of ${cards.length} lines priced. "cost" = value in minus value out at the quote's own USD prices (route, fees and slippage), not a promise.`));
  return 0;
}
