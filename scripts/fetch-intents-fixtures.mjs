// Records REAL dry-run quotes (dry:true) and the token list from the public 1Click API into fixtures/intents/.
// No API key, no funds, no deposit address, nothing executed. Run with: npm run record:intents
// Terms of service: https://docs.near-intents.org/security-compliance/terms-of-service.md (check your own eligibility).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/chain/sources.js';
import { API, ORIGIN, fetchTokens, fetchDryQuote, findToken, PLACEHOLDER_RECIPIENT, buildDryQuoteRequest } from '../src/intents/quote.js';
import { quoteKey } from '../src/intents/preview.js';

const input = JSON.parse(await readFile(path.join(ROOT, 'samples', 'payroll.sample.json'), 'utf8'));
const dir = path.join(ROOT, 'fixtures', 'intents');
await mkdir(dir, { recursive: true });

const tokens = await fetchTokens();
const chains = [...new Set(tokens.map((t) => t.blockchain))].sort();
const recordedAt = new Date().toISOString();
await writeFile(path.join(dir, 'tokens.recorded.json'), `${JSON.stringify({
  _comment: `RECORDED answer of GET ${API}/v0/tokens (no key). Not live.`,
  recorded_at: recordedAt, count: tokens.length, chains: chains.length, tokens,
}, null, 1)}\n`);
console.log(`tokens: ${tokens.length} on ${chains.length} chains`);

const origin = findToken(tokens, ORIGIN.chain, ORIGIN.asset);
const quotes = [];
for (const line of input.lines) {
  const { chain, asset } = line.payout_pref;
  const destination = findToken(tokens, chain, asset);
  const request = buildDryQuoteRequest({ origin, destination, cents: line.amount_cents, recipient: PLACEHOLDER_RECIPIENT[chain] });
  const { http_status, response } = await fetchDryQuote(request);
  const out = response?.quote?.amountOutFormatted;
  console.log(`${quoteKey(chain, asset, line.amount_cents).padEnd(22)} HTTP ${http_status} ${out ? `-> ${out} ${asset}` : JSON.stringify(response).slice(0, 120)}`);
  quotes.push({ key: quoteKey(chain, asset, line.amount_cents), recorded_at: new Date().toISOString(), http_status, request, response });
  await new Promise((r) => setTimeout(r, 400));
}

// One real refusal, so the "unavailable" card is a real API answer too: an amount far too small to bridge.
const tiny = buildDryQuoteRequest({ origin, destination: findToken(tokens, 'btc', 'BTC'), cents: 1, recipient: PLACEHOLDER_RECIPIENT.btc });
const refused = await fetchDryQuote(tiny);
console.log(`tiny BTC quote -> HTTP ${refused.http_status} ${JSON.stringify(refused.response).slice(0, 140)}`);
quotes.push({ key: quoteKey('btc', 'BTC', 1), recorded_at: new Date().toISOString(), http_status: refused.http_status, request: tiny, response: refused.response });

await writeFile(path.join(dir, 'quotes.recorded.json'), `${JSON.stringify({
  _comment: `RECORDED dry-run quotes from POST ${API}/v0/quote with dry:true. No key, no funds, no deposit address, nothing executed. Not live: they are prices from recorded_at.`,
  recorded_at: recordedAt,
  origin: { chain: ORIGIN.chain, asset: ORIGIN.asset, assetId: origin.assetId },
  quotes,
}, null, 1)}\n`);
console.log(`wrote ${quotes.length} quotes`);
