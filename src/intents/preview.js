// Turn dry-run quotes into "what would this person receive" cards. Pure: works in Node and in the browser.
import { findToken, buildDryQuoteRequest, PLACEHOLDER_RECIPIENT, ORIGIN } from './quote.js';

export const quoteKey = (chain, asset, cents) => `${chain}:${asset}:${cents}`;

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * entry: { http_status, response, recorded_at, live }   (what a source returns for a key, or undefined)
 * state: quoted | expired | unavailable
 */
export function makeCard(line, entry, now = Date.now()) {
  const base = {
    employee_account: line.employee_account,
    amount_cents: line.amount_cents,
    currency: line.currency,
    department: line.department ?? '',
    pref: line.payout_pref,
  };
  if (!entry) return { ...base, state: 'unavailable', reason: 'no quote available for this line' };
  const source = entry.live ? 'live' : 'recorded';
  if (entry.http_status !== 201 || !entry.response?.quote) {
    return { ...base, state: 'unavailable', source, quoted_at: entry.recorded_at, reason: entry.response?.message ?? `HTTP ${entry.http_status}` };
  }
  const q = entry.response.quote;
  const validUntil = entry.response.quoteRequest?.deadline ?? null;
  const expired = validUntil ? Date.parse(validUntil) < now : false;
  const inUsd = num(q.amountInUsd);
  const outUsd = num(q.amountOutUsd);
  const costUsd = inUsd !== null && outUsd !== null ? inUsd - outUsd : null;
  return {
    ...base,
    state: expired ? 'expired' : 'quoted',
    source,
    quoted_at: entry.recorded_at ?? entry.response.timestamp,
    valid_until: validUntil,
    receive: { amount: q.amountOutFormatted, usd: outUsd },
    min_receive: q.minAmountOut ? { raw: q.minAmountOut } : null,
    eta_seconds: q.timeEstimate ?? null,
    cost_usd: costUsd,
    cost_pct: costUsd !== null && inUsd ? (costUsd / inUsd) * 100 : null,
    signature: entry.response.signature ?? null,
    correlation_id: entry.response.correlationId ?? null,
  };
}

export function minReceiveFormatted(card, tokens) {
  const t = findToken(tokens, card.pref.chain, card.pref.asset);
  if (!t || !card.min_receive) return null;
  const raw = BigInt(card.min_receive.raw);
  const scale = 10n ** BigInt(t.decimals);
  const whole = raw / scale;
  const frac = (raw % scale).toString().padStart(t.decimals, '0').slice(0, 6).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Cards for every line of a run, from a quote source: async (key, request) => entry | undefined. */
export async function previewLines(lines, tokens, getQuote, now = Date.now()) {
  const origin = findToken(tokens, ORIGIN.chain, ORIGIN.asset);
  const cards = [];
  for (const line of lines) {
    const { chain, asset } = line.payout_pref;
    const destination = findToken(tokens, chain, asset);
    if (!origin || !destination) {
      cards.push({ ...makeCard(line, undefined, now), reason: `${asset} on ${chain} is not in the 1Click token list` });
      continue;
    }
    const recipient = PLACEHOLDER_RECIPIENT[chain];
    if (!recipient) {
      cards.push({ ...makeCard(line, undefined, now), reason: `no dry-run placeholder address for chain ${chain}` });
      continue;
    }
    const request = buildDryQuoteRequest({ origin, destination, cents: line.amount_cents, recipient, now });
    const entry = await getQuote(quoteKey(chain, asset, line.amount_cents), request);
    cards.push(makeCard(line, entry, now));
  }
  return cards;
}
