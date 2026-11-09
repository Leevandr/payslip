# Submission text (ready to paste)

Nothing here has been submitted. The owner submits, after the repository is public and the X post with video exists.

| Form field | Value |
|---|---|
| Project name | Payslip Proof |
| Tracks (select both) | `realworld` Real-World Money (primary), `open` Open Innovation |
| Lead name, email, team size | the owner fills these in (team size: 1) |
| NEAR address for the payout | the owner's own **mainnet** account (named or 64-character implicit). Not created or used by this project |
| Repository URL | the public repository URL (must be public by 2026-11-14 23:59 UTC) |
| Demo post URL | the X post with the video, tagging @NEARProtocol and #NEARHackathon |

Before submitting, re-read https://nearhackathon.com/HACKATHON.md (rules can change). The "Another entry by the same author" section of README.md already names the other project (https://github.com/Leevandr/attested).

## Description (1636 characters; the form accepts 20 to 2000)

```
People paid across borders have to prove income to landlords, banks and consulates, but a PDF payslip is easy to forge, and a payroll that settles in stablecoins leaves no bank statement. Putting the payroll on a public chain would expose every colleague's salary.

Payslip Proof lets an employer commit a payroll run to NEAR as one Merkle root while every pay line stays private. Leaves are salted and domain-separated, the tree has no sums, it is padded with random leaves to hide headcount, and leaf order is shuffled. Each employee gets a payslip file: their own line, a salt and four sibling hashes. A landlord drops it into the web page or runs verify-payslip. The verifier recomputes the root, reads the commitment from the NEAR contract and prints "VERIFIED: 5,800.00 USD for 2026-10, paid by <employer>", or fails. Auditors get disclosure packs for a subset (one department) or, by revealing every line, a full audit. This is not zero-knowledge and the README says so.

How NEAR fits in: our own Rust contract, payroll-commit (near-sdk-rs), stores employer-owned, immutable, revocable commitments with caller-paid storage. The employer's NEAR account is the identity and the access control, and is bound inside every leaf. It is deployed on testnet and tested on a real local sandbox (14 Rust tests, 65 Node tests, tamper cases). NEAR Intents 1Click dry-run quotes show what each person would receive in the asset and chain they prefer (Base, Ethereum, Solana, Bitcoin, NEAR); nothing is ever executed.

Runs from a clean clone with npm run demo, no keys and no network. Recorded and live data are labelled. Not run on mainnet.
```
