// The status timeline of a 1Click swap, as data. Statuses are the ones in the official OpenAPI schema
// (GET /v0/status). This project never starts a real swap, so the fixtures that feed this are SYNTHETIC,
// shaped after that schema, and labelled as such wherever they are shown.
export const STATUSES = ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED'];

const STEPS = [
  { id: 'deposit', label: 'Deposit sent' },
  { id: 'processing', label: 'Swap in progress' },
  { id: 'delivered', label: 'Delivered to the employee' },
];

/**
 * Returns the three steps with a state each (done | active | failed | pending | skipped), a headline, and
 * a plain-language explanation of what the employer should do.
 */
export function timelineFor(status) {
  const s = (a, b, c) => STEPS.map((step, i) => ({ ...step, state: [a, b, c][i] }));
  switch (status) {
    case 'PENDING_DEPOSIT':
      return { tone: 'wait', headline: 'Waiting for the deposit', steps: s('active', 'pending', 'pending'), next: 'Nothing has moved yet. The quote is held until its deadline.' };
    case 'KNOWN_DEPOSIT_TX':
      return { tone: 'wait', headline: 'Deposit seen, waiting for confirmations', steps: s('active', 'pending', 'pending'), next: 'The deposit transaction is known to 1Click; it is not final yet.' };
    case 'INCOMPLETE_DEPOSIT':
      return { tone: 'warn', headline: 'Deposit is below the quoted amount', steps: s('failed', 'pending', 'pending'), next: 'Send the missing amount before the deadline, otherwise the deposit is refunded.' };
    case 'PROCESSING':
      return { tone: 'wait', headline: 'Swap in progress', steps: s('done', 'active', 'pending'), next: 'Cross-chain settlement can take up to about 15 minutes.' };
    case 'SUCCESS':
      return { tone: 'ok', headline: 'Delivered', steps: s('done', 'done', 'done'), next: 'The employee received the asset on their chain.' };
    case 'REFUNDED':
      return { tone: 'warn', headline: 'Refunded to the employer', steps: s('done', 'failed', 'skipped'), next: 'The swap could not complete; the deposit went back to the refund address. Pay again or pay in the funding asset.' };
    case 'FAILED':
      return { tone: 'bad', headline: 'Swap failed', steps: s('done', 'failed', 'skipped'), next: 'Funds are not delivered. Check the refund address and the explorer before retrying.' };
    default:
      return { tone: 'wait', headline: `Unknown status ${status}`, steps: s('pending', 'pending', 'pending'), next: 'This status is not in the schema this build knows.' };
  }
}
