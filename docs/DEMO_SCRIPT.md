# Demo video: shot list (60 to 90 seconds)

One complete moment, no architecture slides: a landlord checks a payslip, and a tampered one fails. Record the browser at about 1280 px wide, plus one terminal window. Prepare before recording: `npm run web` running, a terminal open in the repo, `npm run demo:testnet` tried once so the network works.

| Time | Screen | Say (plain words) |
|---|---|---|
| 0:00 to 0:08 | The Verify tab, hero visible | "If you are paid across borders, proving your income means a PDF anyone can edit, or showing a platform your whole payroll. Payslip Proof fixes that on NEAR." |
| 0:08 to 0:22 | Employer tab: run 2026-10, 11 lines, "Committed", the hash block | "An employer commits one hash of the payroll to NEAR. That is all that is public: the root, the total and a size bucket. Names and amounts never leave the employer. Padding hides the real headcount." Click Download JSON on Ada's row. |
| 0:22 to 0:40 | Verify tab, click "Ada's payslip": green banner, then scroll to the Merkle diagram | "Ada hands this file to a landlord. The page recomputes the root and compares it with the commitment: verified, 5,800 dollars for October, paid by the employer. The landlord saw four hashes. Every other salary stays hidden." |
| 0:40 to 0:52 | Click "Amount raised to 9,800", red banner; click "Payslip from a revoked run", red | "Change one number and it fails. The employer can also revoke a run on chain and every payslip from it fails." |
| 0:52 to 1:06 | Terminal: `npm run demo:testnet`, show the LIVE line and `VERIFIED` | "This is not a mock: this is the contract on NEAR testnet, read live, no key and no account. The contract is our own Rust code: the employer's NEAR account is the only one that can commit or revoke under its name." |
| 1:06 to 1:18 | Payouts tab: cards, then the REFUNDED timeline | "Payroll in any asset: each person's card shows what they would receive on their chosen chain, priced by NEAR Intents. These are dry-run quotes, so nothing is sent, and the page shows what happens when a payout is refunded or fails." |
| 1:18 to 1:25 | README top, then the repo URL | "Everything runs from a clean clone with `npm run demo`, no keys. Recorded and live data are labelled, and nothing ran on mainnet." |

## Do not say

* "Zero-knowledge". It is not. A full-company total can only be checked by revealing all lines to the auditor.
* "Proof of payment". It is the employer's on-chain attestation.
* "Live" for the sandbox or the Intents quotes. They are recorded; only the testnet read is live.

## X post (the owner posts it; edit freely)

> Proving your income across borders shouldn't mean a PDF anyone can edit, or exposing your whole company's payroll. Built at NEAR HACKATHON: Payslip Proof. An employer commits one hash of the payroll on NEAR; each employee gets a payslip a landlord can verify, with no other salary revealed. Own Rust contract, NEAR Intents payout previews. Repo + run steps: <repo URL>. Which document would you want to verify like this? @NEARProtocol #NEARHackathon

Attach the video. Optionally tag @NearLegion and @NearBuilders.
