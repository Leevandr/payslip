// Read-only view call to a NEAR RPC node. Isomorphic (Node 22 and browsers): only fetch, btoa and TextDecoder.
export class ChainUnavailable extends Error {}

function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Calls get_run(employer, run_id) on `contract`. Returns the record, or null when the contract answers null. */
export async function rpcViewGetRun({ rpc, contract, employer, runId, finality = 'final', fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'psp',
        method: 'query',
        params: { request_type: 'call_function', finality, account_id: contract, method_name: 'get_run', args_base64: b64(JSON.stringify({ employer, run_id: runId })) },
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new ChainUnavailable(`cannot reach ${rpc}: ${e.cause?.code ?? e.message}`);
  }
  if (!res.ok) throw new ChainUnavailable(`${rpc} answered HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new ChainUnavailable(`${rpc}: ${body.error.data ?? body.error.message}`);
  const r = body.result;
  if (r?.error) throw new ChainUnavailable(`${rpc}: ${r.error}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
}
