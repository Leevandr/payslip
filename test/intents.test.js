import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './helpers.js';
import {
  buildDryQuoteRequest, fetchDryQuote, centsToBaseUnits, findToken, ORIGIN, PLACEHOLDER_RECIPIENT, QUOTE_VALIDITY_MS,
} from '../src/intents/quote.js';
import { previewLines, makeCard, quoteKey } from '../src/intents/preview.js';
import { timelineFor, STATUSES } from '../src/intents/status.js';
import { sampleInput } from './helpers.js';

const rd = async (f) => JSON.parse(await readFile(path.join(ROOT, 'fixtures', 'intents', f), 'utf8'));

test('fixtures are labelled and real-shaped', async () => {
  const tokens = await rd('tokens.recorded.json');
  assert.equal(tokens.count, 216);
  assert.equal(tokens.tokens.length, 216);
  assert.equal(tokens.chains, 39);
  assert.match(tokens._comment, /RECORDED/);
  const quotes = await rd('quotes.recorded.json');
  assert.match(quotes._comment, /RECORDED/);
  assert.match(quotes._comment, /dry:true/);
  for (const q of quotes.quotes) {
    assert.equal(q.request.dry, true, 'every recorded request is dry');
    assert.equal(q.response?.quote?.depositAddress, undefined, 'no deposit address in any recorded quote');
  }
  const status = await rd('status.synthetic.json');
  assert.match(status._comment, /SYNTHETIC/);
  assert.deepEqual(status.examples.map((e) => e.status).sort(), [...STATUSES].sort());
});

test('safety: requests are always dry, and the code has no path to a real swap', async () => {
  const tokens = (await rd('tokens.recorded.json')).tokens;
  const req = buildDryQuoteRequest({
    origin: findToken(tokens, ORIGIN.chain, ORIGIN.asset), destination: findToken(tokens, 'base', 'USDC'),
    cents: 420000, recipient: PLACEHOLDER_RECIPIENT.base,
  });
  assert.equal(req.dry, true);
  await assert.rejects(() => fetchDryQuote({ ...req, dry: false }, async () => { throw new Error('must not be called'); }), /not dry:true/);
  await assert.rejects(
    () => fetchDryQuote(req, async () => ({ status: 201, json: async () => ({ quote: { depositAddress: 'abc' } }) })),
    /must not carry a deposit address/,
  );
  // static guard: nothing in src/ or scripts/ posts a non-dry quote or touches deposit/submit
  const files = [];
  for (const dir of ['src/intents', 'src/cli', 'src/chain', 'scripts']) {
    for (const f of await readdir(path.join(ROOT, dir))) if (/\.m?js$/.test(f)) files.push(path.join(ROOT, dir, f));
  }
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    assert.ok(!/dry:\s*false/.test(text), `${f} contains dry:false`);
    assert.ok(!text.includes('/v0/deposit'), `${f} references /v0/deposit`);
  }
});

test('base units: 1 USD cent of a 6-decimal token is 10^4 units', () => {
  assert.equal(centsToBaseUnits(420000, 6), '4200000000');
  assert.equal(centsToBaseUnits(1, 6), '10000');
  assert.throws(() => centsToBaseUnits(0, 6));
  assert.throws(() => centsToBaseUnits(1.5, 6));
});

test('recorded quotes: 11 sample lines get cards, expired by design, with value and cost', async () => {
  const tokens = (await rd('tokens.recorded.json')).tokens;
  const rec = await rd('quotes.recorded.json');
  const byKey = new Map(rec.quotes.map((q) => [q.key, q]));
  const lines = (await sampleInput()).lines.map((l) => ({ ...l, currency: 'USD', period: '2026-10' }));
  const cards = await previewLines(lines, tokens, async (key) => byKey.get(key), Date.parse(rec.recorded_at) + 3600e3);
  assert.equal(cards.length, 11);
  for (const c of cards) {
    assert.equal(c.state, 'expired', `${c.employee_account} should be expired an hour after recording`);
    assert.equal(c.source, 'recorded');
    assert.ok(Number(c.receive.amount) > 0);
    assert.ok(c.cost_pct >= -0.5 && c.cost_pct < 1, `cost ${c.cost_pct}`);
  }
  const ada = cards.find((c) => c.employee_account === 'ada-lagos.testnet');
  assert.equal(ada.pref.asset, 'USDC');
  assert.ok(Number(ada.receive.amount) > 5700 && Number(ada.receive.amount) < 5800);
});

test('quote expiry: a fresh quote is "quoted", one past its deadline is "expired"', async () => {
  const rec = await rd('quotes.recorded.json');
  const entry = rec.quotes.find((q) => q.http_status === 201);
  const deadline = Date.parse(entry.response.quoteRequest.deadline);
  const line = { employee_account: 'x.testnet', amount_cents: 1, currency: 'USD', period: '2026-10', payout_pref: { chain: 'base', asset: 'USDC' } };
  assert.equal(makeCard(line, entry, deadline - 1000).state, 'quoted');
  assert.equal(makeCard(line, entry, deadline + 1000).state, 'expired');
  assert.equal(QUOTE_VALIDITY_MS, 600000);
});

test('a real API refusal becomes an "unavailable" card with the API message', async () => {
  const rec = await rd('quotes.recorded.json');
  const refused = rec.quotes.find((q) => q.http_status !== 201);
  assert.ok(refused, 'the fixtures hold one real refusal');
  const card = makeCard({ employee_account: 'x.testnet', amount_cents: 1, currency: 'USD', period: '2026-10', payout_pref: { chain: 'btc', asset: 'BTC' } }, refused);
  assert.equal(card.state, 'unavailable');
  assert.match(card.reason, /too low/);
  assert.equal(makeCard({ employee_account: 'x.testnet', amount_cents: 1, payout_pref: { chain: 'btc', asset: 'BTC' } }, undefined).state, 'unavailable');
});

test('unknown asset or chain: unavailable, never a made-up amount', async () => {
  const tokens = (await rd('tokens.recorded.json')).tokens;
  const mk = (chain, asset) => ({ employee_account: 'x.testnet', amount_cents: 100000, currency: 'USD', period: '2026-10', payout_pref: { chain, asset } });
  const cards = await previewLines([mk('base', 'NOPE'), mk('nochain', 'USDC')], tokens, async () => { throw new Error('should not quote'); });
  assert.deepEqual(cards.map((c) => c.state), ['unavailable', 'unavailable']);
  assert.match(cards[0].reason, /not in the 1Click token list/);
  assert.equal(quoteKey('base', 'USDC', 5), 'base:USDC:5');
});

test('status timeline: every status has three steps and an honest next action', () => {
  for (const s of STATUSES) {
    const t = timelineFor(s);
    assert.equal(t.steps.length, 3, s);
    assert.ok(t.headline && t.next);
  }
  assert.deepEqual(timelineFor('SUCCESS').steps.map((x) => x.state), ['done', 'done', 'done']);
  assert.deepEqual(timelineFor('REFUNDED').steps.map((x) => x.state), ['done', 'failed', 'skipped']);
  assert.equal(timelineFor('REFUNDED').tone, 'warn');
  assert.equal(timelineFor('FAILED').tone, 'bad');
  assert.equal(timelineFor('INCOMPLETE_DEPOSIT').steps[0].state, 'failed');
  assert.equal(timelineFor('WHATEVER').tone, 'wait');
});
