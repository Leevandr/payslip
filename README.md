# Payslip Proof

**Proof of income you can verify against NEAR without exposing anyone else's pay.**

Get paid across borders in any asset, and hand a landlord, bank or consulate a payslip they can verify against NEAR, without revealing a single other salary.

Tracks: Real-World Money (primary), Open Innovation. Built for NEAR HACKATHON, November 2026. MIT licensed.

## What it is

An employer builds a payroll run. Every pay line becomes one salted leaf of a Merkle tree; only the root goes on NEAR, through a small Rust contract (`payroll-commit`). Each employee gets a **payslip file**: their own line, a random salt, and a few sibling hashes. Anyone can verify that file: recompute the root, read the commitment from NEAR, compare. Green or red.

The tree has no sums in it, it is padded with random leaves so the headcount is hidden, and the leaf order is shuffled. A payslip reveals the holder's own line and some hashes, nothing else. An auditor can be given a disclosure pack for a subset of lines (one department), or, by revealing every line, a full audit pack.

Payouts: for every line the app shows what that person would receive in the asset and chain they chose, priced with a NEAR Intents 1Click **dry-run quote**. Nothing is ever sent.

## The problem

People paid across borders, freelancers and remote staff in particular, have to prove income to landlords, banks and consulates. Today that is a PDF anyone can edit, or a payroll platform that hands over more than needed. A payroll that settles in stablecoins or other assets leaves no bank statement at all. Putting the whole payroll on a public chain exposes every colleague's salary. This project commits to a payroll on NEAR while keeping every individual line private, and lets the holder of one line prove just that line.

## Try it: do X, see Y

You need **Node 22.22.2 or newer** (tested on 22.23.1). Steps 1 to 5 need no `npm ci`, no network, no environment variables and no keys. Step 6 needs no install either (only its two examples marked Live need network). Every command below was run from a clean copy of this repository; the outputs shown are what it prints (timestamps and the `payout-preview` timing may differ).

### 1. Run the tests

```
npm test
```

See: `# tests 65`, `# pass 65`, `# fail 0` (a few seconds). They cover the leaf encoding with a known answer, the Merkle code on trees of 1 to 33 leaves, every tamper case (changed amount, changed salt, wrong sibling, wrong employer, copy-root attack, revoked run, wrong depth), the privacy properties of a payslip, disclosure packs, the CLI and its exit codes, the dry-run-only guarantee of the Intents code, and a Python re-implementation that must agree with the Node one.

### 2. Run the whole story

```
npm run demo
```

See, in about a second, 7 numbered sections. The important lines:

```
== 1. The employer builds October payroll for 11 fictional people
built run 2026-10 for acme-payroll.test.near, period 2026-10
  lines            : 11 real + 5 random padding leaves = 16 leaves (public bucket: 16)
  declared total   : 38,180.00 USD
  merkle root      : 11b07b6364d1dbf8c17888e82f5147ecffc297782f89f57e7b7d164368cebd12

== 3. Ada hands the file to a landlord, who verifies it against the chain
chain source: RECORDED  fixtures/chain/sandbox-recorded.json (sandbox, contract payroll-commit.test.near, recorded 2026-11-09T05:21:10.946Z). Not a live chain read.
  ok   contract payroll-commit.test.near is the official sandbox contract
  ok   leaf recomputed from the line and its salt: a5636e374b2ebd60...
  ok   4 sibling hashes fold the leaf up to root 11b07b6364d1dbf8...
  ok   commitment found for acme-payroll.test.near / run 2026-10 (period 2026-10, bucket 16)
  ok   run is not revoked
  ok   recomputed root equals the committed root
  ok   proof depth 4 matches the committed headcount bucket 16
VERIFIED: 5,800.00 USD for 2026-10, paid by acme-payroll.test.near

== 4. Tamper tests: each of these must FAIL
FAILED: recomputed root 263767a2b07395a0... does not equal the committed root 11b07b6364d1dbf8...     (amount raised)
FAILED: recomputed root cb18645980732a4a... does not equal the committed root 11b07b6364d1dbf8...     (wrong sibling)
FAILED: no commitment found on chain for other-payroll.test.near / run 2026-10                          (wrong employer)
FAILED: the employer REVOKED this run on 2026-11-09; its payslips are no longer valid                   (revoked run)

== 5. ... ONE department (Engineering), nobody else
VERIFIED SUBSET: 3 lines, subtotal 16,250.00 USD for 2026-10, employer acme-payroll.test.near
  not verified: the company total (38,180.00 USD is only the employer's declaration; the other leaves stay hidden)
  not verified: that this list is complete for its selector (an employer could omit a line); only a full audit pack proves completeness

== 6. A full-company total can only be checked by revealing every line to the auditor
VERIFIED FULL AUDIT: 11 lines (+5 padding leaves) rebuild the on-chain root; total 38,180.00 USD equals the declared total, period 2026-10, employer acme-payroll.test.near

== 7. What would each person receive in the asset and chain they prefer?
ada-lagos.testnet           5,800.00  USDC on base         5,799.463154 USDC   0.01%   22 s  expired
carla-lima.testnet          6,150.00  ETH on eth                2.874959 ETH   0.16%   27 s  expired
hiro-osaka.testnet          3,100.00  BTC on btc                0.041502 BTC   0.18%  465 s  expired
... (11 lines, from RECORDED dry-run quotes of 2026-11-09; "expired" because a quote lives 10 minutes)
Demo finished: every expected success succeeded and every tamper attempt failed.
```

The sample uses a fixed `--seed` so every number above reproduces exactly. **A real run omits `--seed`** and uses random salts; the sample's salts are public and therefore not private.

### 3. Verify one payslip by hand, then break it

```
node bin/payslip-proof.js build-run --input samples/payroll.sample.json --out out/run --seed psp-demo-seed-2026
node bin/payslip-proof.js export-payslips --run out/run/run.private.json --out out/payslips --network sandbox
node bin/payslip-proof.js verify-payslip out/payslips/payslip-ada-lagos.testnet.json
```

See `wrote 11 payslips to out/payslips/ ...` and then the last line `VERIFIED: 5,800.00 USD for 2026-10, paid by acme-payroll.test.near`, exit code 0. Now raise the amount in a copy:

```
sed 's/"amount_cents": 580000/"amount_cents": 980000/' out/payslips/payslip-ada-lagos.testnet.json > out/tampered.json
node bin/payslip-proof.js verify-payslip out/tampered.json
```

See `FAILED: recomputed root 263767a2b07395a0... does not equal the committed root 11b07b6364d1dbf8...` and exit code 1 (`echo $?`). Add `--json` to either command for machine-readable output. Exit codes: 0 verified, 1 verification failed, 2 bad input, 3 the chain refused a transaction, 70 internal error.

### 4. Hand an auditor one department, or everything

```
node bin/payslip-proof.js export-disclosure --run out/run/run.private.json --department Engineering --out out/engineering.json --network sandbox
node bin/payslip-proof.js verify-disclosure out/engineering.json
node bin/payslip-proof.js export-disclosure --run out/run/run.private.json --all --out out/full.json --network sandbox
node bin/payslip-proof.js verify-disclosure out/full.json
```

See `VERIFIED SUBSET: 3 lines, subtotal 16,250.00 USD ...` followed by two `not verified:` lines that say what the pack cannot prove, then `VERIFIED FULL AUDIT: 11 lines (+5 padding leaves) rebuild the on-chain root; total 38,180.00 USD equals the declared total`. A full-company total can be checked only by revealing all lines to the auditor. This is not zero-knowledge and does not pretend to be.

### 5. See what each person would receive (recorded Intents quotes)

```
node bin/payslip-proof.js payout-preview --run out/run/run.private.json
```

See a table of 11 employees with the amount each would receive in their chosen asset and chain, the cost and the estimated time, labelled `RECORDED dry-run quotes recorded 2026-11-09T05:23:39.793Z ... Not live prices` and `DRY RUN ONLY: no deposit address exists, nothing is sent`. The quotes are real answers of the 1Click API saved in `fixtures/intents/`. Quotes live 10 minutes, so each card is marked `quoted` or `expired` against its own deadline. With network access, `--live` prices them again (still `dry:true`; the amounts, not the names, are sent to the 1Click API).

### 6. Open the web page

```
npm run web
```

See `Payslip Proof is at http://127.0.0.1:5173/`. Open it. Three tabs: **Verify** (drop a `payslip.json`, or click an example, and get a green or red result with the Merkle path drawn), **Employer** (the run, the on-chain commitment, downloads of payslips and auditor packs), **Payouts** (payout cards from the recorded quotes, and the status timeline for every outcome including REFUNDED, FAILED and INCOMPLETE_DEPOSIT). It follows your light or dark setting. The page runs the same verification code as the CLI, in your browser.

### 7. Read the real NEAR testnet (read-only, needs network, no key)

```
npm run demo:testnet
```

See `chain source: LIVE  https://test.rpc.fastnear.com (testnet, contract payroll-commit-e0e6ee.testnet)` and `VERIFIED: 5,800.00 USD for 2026-10, paid by acme-payroll-e0e6ee.testnet`, then a changed-amount payslip failing against the same live commitment, a subset pack and a full pack verifying. No account or funds are involved; it only calls a view function. Transactions: [deploy](https://testnet.nearblocks.io/txns/2SeLTSSL3bnG8LwbPiRTrrRwpCwzdRwoCafUxDdUV1F1), [commit_run](https://testnet.nearblocks.io/txns/3Q9EgoykTwZxax9DL6CkrrySQPWGeFbETcu5Cs3KGgG9). Offline, add `--chain fixture` to any `verify-` command to use the recorded copy instead.

### 8. Run the contract on a live local NEAR chain

```
npm ci
npm run demo:chain
```

`npm ci` installs one dependency (`near-kit` 0.20.2). The first run downloads the NEAR sandbox binary. See (about 16 seconds): a local nearcore chain starts, the real contract wasm is deployed on it, the run is committed (`commit`), the same payslip verifies with `chain source: LIVE  local NEAR sandbox`, a tampered one fails, the employer revokes the run and the same payslip now fails with `the employer REVOKED this run`, and committing the same `run_id` again is refused by the contract (`error: the contract refused: this run_id is already committed for your account; ...`, exit code 3). For manual use: `npm run sandbox` in one terminal, then `commit`, `revoke` and `verify-payslip` in another.

### 9. Contract tests (needs Rust)

```
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh -o cargo-near-installer.sh
less cargo-near-installer.sh && CARGO_NEAR_NO_MODIFY_PATH=1 sh cargo-near-installer.sh
npm run test:contract
```

`cargo-near` is needed because `near-workspaces` compiles the contract with `cargo near build`. The toolchain is pinned in `rust-toolchain.toml` (1.86.0, installed by `rustup` on first use). See `test result: ok. 10 passed` (unit) and `test result: ok. 4 passed` (real nearcore sandbox: commit and view, no overwrite, only the owner can revoke, history kept after revoke, storage paid by the caller with the surplus refunded, invalid input refused on chain).

### 10. Optional: test the web page in a real browser

```
CHROME=/path/to/chromium npm run test:browser
```

Uploads real files into the page in headless Chromium: a genuine payslip turns green, a tampered one, a non-JSON file and a payslip with HTML in a field do not, nothing is injected, and the live testnet example verifies. Not part of `npm test` because it needs a browser.

## Privacy properties, stated precisely

| | Learns | Does not learn |
|---|---|---|
| Anyone reading the chain | root, period, currency, **declared total**, **headcount bucket**, employer account, commit and revoke times | any name, any individual amount, the true headcount (only that it is at most the bucket and above half of it once the bucket is above 8) |
| Holder of one payslip | their own line and salt, `log2(bucket)` sibling hashes, a random leaf position | any other line or amount; which leaves are padding |
| Auditor with a subset pack | the listed lines and their subtotal | the other lines; whether the subset is complete |
| Auditor with a full pack | everything in the run, including the true headcount | nothing is hidden from them |

**Not hidden:** the declared total and the bucket are public, so average pay per head is bounded. The employer account and the commit time are public. A payslip holder can show their payslip to anyone, and it shows their department field. Every payslip of one run carries the same root, so two holders can tell they share an employer and run (not what anyone earns).

**Not proven:** that money was paid. The commitment is the employer account's attestation on chain, not a settlement receipt. A verifier must know out of band that the employer account really belongs to the employer. A subset pack cannot show that nothing was left out.

The exact formats, the tree rules and ten design flaws found and fixed in the written design are in [`docs/SPEC.md`](docs/SPEC.md).

## NEAR integrations

* **Own Rust contract `payroll-commit`** (near-sdk-rs 5.24, [`contracts/payroll-commit`](contracts/payroll-commit/src/lib.rs)). `commit_run(run_id, root, period, currency, declared_total_cents, headcount_bucket)` is callable only for the calling account's own namespace, cannot overwrite a run id, and is `payable` so the caller pays for its own storage and gets the surplus back. `revoke_run(run_id)` marks a run revoked and keeps the record. `get_run(employer, run_id)` is the view. It emits NEP-297 style `EVENT_JSON` logs. Prebuilt wasm: `contracts/payroll-commit/res/payroll_commit.wasm` (160,515 bytes, sha256 `241ae90171b4f6603dc602dc5737aa863c7ef0be0260609a8097aa67c1ca1bf8`); it is built with `cargo near build non-reproducible-wasm`, so a rebuild on another machine may differ byte for byte.
* **NEAR testnet deployment:** contract `payroll-commit-e0e6ee.testnet`, employer `acme-payroll-e0e6ee.testnet`, both throwaway accounts created through the public testnet faucet. Anyone can verify against it read-only.
* **NEAR accounts as identity:** the employer is a NEAR account; only that account can commit or revoke under its name, and the account id is inside every leaf.
* **Local NEAR sandbox** (nearcore, via `near-kit/sandbox` and `near-workspaces`) for the end-to-end flow and the contract tests.
* **NEAR Intents 1Click API, dry-run only:** `GET /v0/tokens` (216 tokens on 39 chains at the time of recording) and `POST /v0/quote` with `"dry": true`. No key, no funds, no deposit address. Funding asset: USDC on NEAR. Destinations include Base, Arbitrum, Ethereum, Solana, Bitcoin and NEAR.

**Intents terms of service.** The Intents API terms restrict use by persons resident in restricted jurisdictions and forbid VPN or proxy circumvention. This project uses dry-run quotes only and never executes a swap or makes a deposit; it did not use a VPN or proxy. If you run `--live`, check your own eligibility first. [Terms](https://docs.near-intents.org/security-compliance/terms-of-service.md).

## Recorded versus live

| What | In `npm test`, `npm run demo` and the web page by default | Live option |
|---|---|---|
| NEAR commitment read, sandbox payslips | **Recorded**: answers of a real local nearcore sandbox, saved by `npm run record:chain` (`fixtures/chain/sandbox-recorded.json`) | `npm run demo:chain` / `npm run sandbox` |
| NEAR commitment read, testnet payslips | CLI: live if reachable, otherwise the **recorded** copy (`fixtures/chain/testnet-recorded.json`), and it says which. Web page: live read from the browser, with the same fallback | `npm run demo:testnet` |
| Contract behaviour | Executed on a real local sandbox by `cargo test` | n/a |
| Intents token list and quotes | **Recorded** real dry-run answers of 2026-11-09 (`fixtures/intents/`), refresh with `npm run record:intents` | `payout-preview --live` |
| Intents status timeline (REFUNDED, FAILED, INCOMPLETE_DEPOSIT, ...) | **Synthetic**: shaped after the documented status schema. A real status needs a real deposit, which this project never makes | none |
| Payout execution | does not exist | none |

## What was not run on mainnet

Everything. No mainnet account, key, transaction, deploy or RPC call was used. The code has no mainnet mode; `--network mainnet` is refused with exit code 2. The only call to a mainnet-only service is the Intents 1Click API with `dry:true`, because Intents has no testnet. No swap, deposit or transfer was executed.

## Known limits

* An attestation, not a payment receipt (see above). Linking a payslip to a settlement receipt (for example the 1Click status of the payout) is the obvious next step and is not built.
* Revocation is per run, not per person. A correction is a new run id; the contract refuses to overwrite.
* The declared total and the bucket are public by design.
* The contract is not audited and has no admin, pause or upgrade path. It stores one small record per run.
* The sample's salts come from a public seed so the demo reproduces; sample payslips are therefore not private. Real runs use the operating system's random generator.
* `npm run sandbox` starts the NEAR sandbox through `near-kit`, which listens on all network interfaces with the sandbox's well-known test root key. It holds no value, but do not run it on an untrusted network.
* The web page checks sandbox payslips against recorded answers. Only testnet payslips are read live in the browser, and for those the page sends the employer account and run id (not the payslip) to the public testnet RPC node. Any live read tells that RPC node which run you looked up.
* The 1Click quote signature is stored in the fixtures but not verified. Quote prices are not offers; the "cost" column is value in minus value out at the quote's own USD prices.
* Tested on Linux only. No legal, tax or compliance advice; nothing here is a payroll product.

## How this was built (AI disclosure) and what it uses

All code, tests, docs and the design of this repository were written by an AI coding agent (Claude, Anthropic) working for the project owner during the hackathon window. All of it was written on or after 2026-11-09; there is no earlier code. Nobody has audited the contract.

Third-party code and assets:

* **near-sdk** 5.24.1 (MIT OR Apache-2.0), **near-workspaces** 0.22.1, tokio and serde_json (dev only): Rust crates, pinned by `contracts/payroll-commit/Cargo.lock`.
* **near-kit** 0.20.2 (MIT) and its dependencies (MIT, ISC, BlueOak-1.0.0): the only npm dependency, pinned by `package-lock.json`.
* **cargo-near** 0.23.0: build tool, installed by its official installer, not vendored.
* **near/cargo-near-new-project-template**: the contract's `Cargo.toml` layout, release profile, `rust-toolchain.toml` and the `near-workspaces` test setup started from it. `contracts/payroll-commit/Cargo.lock` started as its lock file.
* **Inter** and **JetBrains Mono** web fonts (SIL Open Font License 1.1), in `web/fonts/` with their licences.
* NEAR Intents 1Click API: called, not copied. Its answers are saved under `fixtures/intents/`.

## Layout

```
src/core/       payroll library: encoding, Merkle tree, run builder, verifier (runs in Node and in the browser)
src/cli/        the CLI           bin/payslip-proof.js
src/chain/      chain sources (live RPC, recorded fixture, sandbox) and signing
src/intents/    1Click dry-run quotes, payout preview, status timeline
contracts/      the Rust contract, its unit tests and sandbox tests
web/            static page (no framework)       scripts/   demos, recorders, build, server
samples/        fictional payroll and the testnet payslips   fixtures/   recorded chain and Intents answers
docs/           SPEC.md, DEMO_SCRIPT.md, PRESCREEN_SELFTEST.md
```

## Another entry by the same author

The hackathon rules ask each README to name the author's other submission (one person may enter two independent projects). The other entry is **Attested**, verifiable receipts for private AI on NEAR: <https://github.com/Leevandr/attested>. The two projects are independent and share no code.

## License

MIT, see [LICENSE](LICENSE).
