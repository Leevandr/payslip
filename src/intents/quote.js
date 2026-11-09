// NEAR Intents 1Click: dry-run quotes only.
//
// SAFETY: this project never executes a swap and never creates a deposit address. Every request
// built here has dry:true, fetchDryQuote refuses anything else, and there is deliberately no code
// for the deposit-submit endpoint or for polling the status of a real swap.
export const API = 'https://1click.chaindefuser.com';

// The employer funds payroll in USDC on NEAR (6 decimals). One USD cent = 10^4 base units.
export const ORIGIN = { chain: 'near', asset: 'USDC' };

// Public, well-known addresses used ONLY as dry-run recipients and refund address. 1Click validates the
// format (and, for NEAR, that the account exists), so made-up addresses and burn addresses are refused.
// Nothing is ever sent to them: a dry quote has no deposit address and moves no funds.
const WETH9 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
export const PLACEHOLDER_RECIPIENT = {
  eth: WETH9, base: WETH9, arb: WETH9, op: WETH9, pol: WETH9, bsc: WETH9, avax: WETH9,
  sol: 'So11111111111111111111111111111111111111112',
  btc: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  near: 'wrap.near',
};
export const PLACEHOLDER_REFUND = 'wrap.near';

export const QUOTE_VALIDITY_MS = 10 * 60 * 1000;

export function findToken(tokens, chain, asset) {
  return tokens.find((t) => t.blockchain === chain && t.symbol === asset) ?? null;
}

export function centsToBaseUnits(cents, decimals) {
  if (!Number.isInteger(cents) || cents <= 0) throw new RangeError('cents must be a positive integer');
  if (decimals < 2) throw new RangeError('token has fewer than 2 decimals');
  return (BigInt(cents) * 10n ** BigInt(decimals - 2)).toString();
}

export function buildDryQuoteRequest({ origin, destination, cents, recipient, now = Date.now() }) {
  return {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: origin.assetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: destination.assetId,
    amount: centsToBaseUnits(cents, origin.decimals),
    refundTo: PLACEHOLDER_REFUND,
    refundType: 'ORIGIN_CHAIN',
    recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(now + QUOTE_VALIDITY_MS).toISOString(),
  };
}

export async function fetchDryQuote(request, fetchImpl = fetch) {
  if (request.dry !== true) throw new Error('refusing to send a quote request that is not dry:true');
  const res = await fetchImpl(`${API}/v0/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(20000),
  });
  let body;
  try { body = await res.json(); } catch { body = { message: 'non-JSON answer' }; }
  if (body?.quote?.depositAddress) throw new Error('a dry quote must not carry a deposit address; aborting');
  return { http_status: res.status, response: body };
}

export async function fetchTokens(fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/v0/tokens`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`/v0/tokens answered HTTP ${res.status}`);
  return res.json();
}
