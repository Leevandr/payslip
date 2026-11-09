# Pre-screen self-test (fresh clone)

What a Claude Code or Codex pre-screen would do: take the repository as it is, in a new empty directory, and run the README steps. This is the log of doing exactly that.

**Method.** `cp -r` of the repository into a new empty directory, then `node_modules`, `contracts/payroll-commit/target`, `out`, `dist` and `.sandbox` removed from the copy (so no build output came along). Every command ran through a small driver with an environment of only `PATH`, `HOME` and `LANG`: **no other environment variable was set**, and no key or account exists in that copy. The driver ran the README steps in README order and checked each exit code against the one the README promises (tamper cases expect 1). Run on 2026-11-09.

**Result: every step behaved as the README says.** Steps 1 to 6 ran with no `npm ci` and (steps 1 to 5) no network.

## What was found and fixed while testing

* A verification that crashed would have exited with code 1, the same as "verification failed". Crashes now exit 70, so a crash can never pass for a failed check. The CLI also now maps a refusal by the contract to its own exit code 3 instead of a stack trace.
* The first recorded answer from a real NEAR sandbox showed that the contract returns time stamps as strings; the verifier crashed formatting the revoked date. Fixed, and a revoked run is now a recorded real chain state in the fixtures.
* `npm run sandbox` started the chain and then exited at once, leaving an orphan chain process behind. It now keeps running until Ctrl-C and the chain is tied to the process.
* `payout-preview --live` with no network ended in a stack trace; it now says it cannot reach the 1Click API (exit 2). The same goes for the testnet read.
* The tests were not hermetic: a sandbox left running changed their result. They now ignore it (`PAYSLIP_PROOF_SANDBOX_STATE`).

## What this log does not show

* One machine only (Linux, Node 22.23.1, Python 3.12.3, Rust 1.86.0 pinned plus the default 1.97.1). Not tried on macOS, Windows or in a container.
* The network was available. The no-network behaviour is covered by `test/offline.test.js`, which makes every `fetch()` fail; it was not tried with the network cable pulled.
* The NEAR sandbox binary (`~/.near-kit`) and the Rust crate cache were already warm from earlier work, so step 8 and 9 did not download them in this run. A first run downloads the sandbox binary and the crates. `cargo-near` was installed earlier from its official installer (read before running).
* Step 6 only shows that the web server answers for the page and its data; the page itself is exercised by step 10, in a real headless Chromium. Nobody has opened it in Safari or Firefox.
* Nothing here touched mainnet.

## Log

### environment

`node -v && npm -v && cat /etc/os-release | head -2`

Result: as expected, exit code 0 (expected 0), 0.1 s.

```
v22.23.1
10.9.8
PRETTY_NAME="Ubuntu 24.04.5 LTS"
NAME="Ubuntu"
```

### 1. npm test (no npm ci yet, no network needed)

`npm test`

Result: as expected, exit code 0 (expected 0), 1.0 s.

```
ok 1 - verify-payslip: verified, exit 0, exact summary line, labelled as recorded when no chain is up
ok 2 - verify-payslip: auto mode falls back to the fixture and says so
ok 3 - verify-payslip: --json is machine readable
ok 4 - verify-payslip: tampered amount exits 1 with FAILED
ok 5 - verify-payslip: a payslip pointing at an unofficial contract is refused
ok 6 - verify-payslip: revoked run (recorded from a real sandbox) exits 1
ok 7 - the recorded fixture still matches a deterministic rebuild of the sample (format drift alarm)
ok 8 - disclosure via the CLI: subset and full audit verify, tampering fails
ok 9 - usage errors exit 2: unknown flag, missing file, bad input, unknown command, mainnet
ok 10 - payout-preview prints a priced line per employee from the recorded quotes and flags them as recorded
ok 11 - no sandbox running: --chain sandbox fails clearly (exit 2) and says how to start one
ok 12 - rpc view: parses a contract answer and maps failures to ChainUnavailable
ok 13 - an independent Python implementation (scripts/reference_verify.py) folds every payslip to the same root
ok 14 - sha256 wrapper agrees with node:crypto
ok 15 - leaf hash known answer (also reproduced by an independent Python script, see docs/SPEC.md)
ok 16 - leaf preimage starts with the domain label and ends with the salt
ok 17 - every committed field changes the leaf hash
ok 18 - length prefixes stop field-boundary tricks
ok 19 - dummy leaves use their own domain
ok 20 - validation rejects malformed lines
ok 21 - formatAmount
ok 22 - merkle: every leaf proves in trees of 1..33 leaves, odd nodes are promoted
ok 23 - merkle: 3-leaf tree promotes the odd leaf unchanged (no duplication)
ok 24 - merkle: a wrong sibling, wrong side or extra step breaks the root
ok 25 - leaf and node hashes are domain separated (an inner node cannot pass as a leaf)
ok 26 - rng: seeded stream is reproducible, unseeded is not
ok 27 - hex helpers are strict
ok 28 - fixtures are labelled and real-shaped
ok 29 - safety: requests are always dry, and the code has no path to a real swap
ok 30 - base units: 1 USD cent of a 6-decimal token is 10^4 units
ok 31 - recorded quotes: 11 sample lines get cards, expired by design, with value and cost
ok 32 - quote expiry: a fresh quote is "quoted", one past its deadline is "expired"
ok 33 - a real API refusal becomes an "unavailable" card with the API message
ok 34 - unknown asset or chain: unavailable, never a made-up amount
ok 35 - status timeline: every status has three steps and an honest next action
ok 36 - testnet payslip with no network: falls back to the recorded testnet answer and says so
ok 37 - testnet payslip with --chain testnet and no network: fails loudly (exit 1), never silently recorded
ok 38 - the testnet disclosure packs verify offline from the recorded answer
ok 39 - payout-preview works with no network (recorded quotes) and --live fails loudly
ok 40 - sample run: deterministic with a seed, random without
ok 41 - sample run: root is pinned (a format change must be a conscious decision)
ok 42 - padding hides the headcount: 11 lines are committed as a bucket of 16, with padding leaves
ok 43 - leaf order is shuffled: tree position does not follow input order
ok 44 - rebuild reproduces the stored root and rejects a doctored private file
ok 45 - input validation: duplicates, mixed currency, wrong period, empty, bad employer
ok 46 - the commitment holds only root, period, currency, total, bucket and identity
ok 47 - disclosure selectors and a selector with no match
ok 48 - happy path: every payslip verifies and prints the contract-specified summary line
ok 49 - tamper: changed amount
ok 50 - tamper: changed salt, department, payout preference, account, period
ok 51 - tamper: wrong sibling hash, flipped side, dropped step, extra step
ok 52 - tamper: wrong employer named in the payslip
ok 53 - tamper: copy-root attack (an impostor commits the same root under their own account)
ok 54 - tamper: wrong run_id and no commitment at all
ok 55 - tamper: revoked run
ok 56 - tamper: committed root or bucket differs from the proof
ok 57 - malformed payslips fail cleanly, never throw
ok 58 - privacy: a payslip carries nothing about anyone else
ok 59 - privacy: the same payroll built twice with real randomness shares no proof hashes
ok 60 - privacy: an unseeded run does not reveal the true headcount in proof length
ok 61 - disclosure subset: verifies and recomputes the subtotal; says what it did not verify
ok 62 - disclosure subset: tampered amount, duplicated line, wrong proof, wrong root all fail
ok 63 - disclosure subset: an omitted line is NOT detected (documented limit)
ok 64 - full audit: rebuilds the on-chain root, total equals the declared total
ok 65 - full audit: hiding a real line behind a padding seed, a changed line, or a wrong declared total all fail
# tests 65
# suites 0
# pass 65
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### 2. npm run demo (no env vars, no node_modules)

`npm run demo`

Result: as expected, exit code 0 (expected 0), 0.5 s.

```

> payslip-proof@0.1.0 demo
> node scripts/demo.mjs


== 1. The employer builds October payroll for 11 fictional people
Salts are fixed by --seed so this sample reproduces byte for byte. Real runs omit --seed and use random salts.

$ payslip-proof build-run --input samples/payroll.sample.json --out out/demo/run --seed psp-demo-seed-2026
built run 2026-10 for acme-payroll.test.near, period 2026-10
  lines            : 11 real + 5 random padding leaves = 16 leaves (public bucket: 16)
  declared total   : 38,180.00 USD
  merkle root      : 11b07b6364d1dbf8c17888e82f5147ecffc297782f89f57e7b7d164368cebd12
  private file     : out/demo/run/run.private.json  (secret: holds every salt)
  public commitment: out/demo/run/commitment.json
  NOTE: --seed makes salts and padding deterministic. Use it only for the public sample; real runs omit it.

== 2. One payslip file per employee

$ payslip-proof export-payslips --run out/demo/run/run.private.json --out out/demo/payslips --network sandbox
wrote 11 payslips to out/demo/payslips/ (each holds one line, its salt and 4 sibling hashes; nothing about anyone else)
Ada's file holds only her own line, her salt and 4 sibling hashes: format, employer, run_id, network, line, salt, proof.

== 3. Ada hands the file to a landlord, who verifies it against the chain

$ payslip-proof verify-payslip out/demo/payslips/payslip-ada-lagos.testnet.json
chain source: RECORDED  fixtures/chain/sandbox-recorded.json (sandbox, contract payroll-commit.test.near, recorded 2026-11-09T05:21:10.946Z). Not a live chain read.
  note: no live chain reachable (no local sandbox is running), so this answer comes from the recorded fixture. For a live local chain: npm run sandbox
  ok   contract payroll-commit.test.near is the official sandbox contract
  ok   leaf recomputed from the line and its salt: a5636e374b2ebd60...
... (90 lines omitted) ...
grace-nairobi.testnet       2,625.00  USDC on base         2,624.787623 USDC   0.01%   22 s  expired
hiro-osaka.testnet          3,100.00  BTC on btc                0.041502 BTC   0.18%  465 s  expired
ines-porto.testnet          2,150.00  USDC on eth          2,149.287219 USDC   0.03%   27 s  expired
jomo-accra.testnet          1,980.00  USDC on base         1,979.845155 USDC   0.01%   22 s  expired
kamala-pune.testnet         1,875.00  USDC on sol          1,874.672296 USDC   0.02%   17 s  expired

11 of 11 lines priced. "cost" = value in minus value out at the quote's own USD prices (route, fees and slippage), not a promise.

Demo finished: every expected success succeeded and every tamper attempt failed.
Next: npm run demo:chain runs the same flow against a live local NEAR sandbox (needs `npm ci`).
```

### 3a. build-run

`node bin/payslip-proof.js build-run --input samples/payroll.sample.json --out out/run --seed psp-demo-seed-2026`

Result: as expected, exit code 0 (expected 0), 0.0 s.

```
built run 2026-10 for acme-payroll.test.near, period 2026-10
  lines            : 11 real + 5 random padding leaves = 16 leaves (public bucket: 16)
  declared total   : 38,180.00 USD
  merkle root      : 11b07b6364d1dbf8c17888e82f5147ecffc297782f89f57e7b7d164368cebd12
  private file     : out/run/run.private.json  (secret: holds every salt)
  public commitment: out/run/commitment.json
  NOTE: --seed makes salts and padding deterministic. Use it only for the public sample; real runs omit it.
```

### 3b. export-payslips

`node bin/payslip-proof.js export-payslips --run out/run/run.private.json --out out/payslips --network sandbox`

Result: as expected, exit code 0 (expected 0), 0.0 s.

```
wrote 11 payslips to out/payslips/ (each holds one line, its salt and 4 sibling hashes; nothing about anyone else)
```

### 3c. verify-payslip (expect VERIFIED, exit 0)

`node bin/payslip-proof.js verify-payslip out/payslips/payslip-ada-lagos.testnet.json`

Result: as expected, exit code 0 (expected 0), 0.0 s.

```
chain source: RECORDED  fixtures/chain/sandbox-recorded.json (sandbox, contract payroll-commit.test.near, recorded 2026-11-09T05:21:10.946Z). Not a live chain read.
  note: no live chain reachable (no local sandbox is running), so this answer comes from the recorded fixture. For a live local chain: npm run sandbox
  ok   contract payroll-commit.test.near is the official sandbox contract
  ok   leaf recomputed from the line and its salt: a5636e374b2ebd60...
  ok   4 sibling hashes fold the leaf up to root 11b07b6364d1dbf8...
  ok   commitment found for acme-payroll.test.near / run 2026-10 (period 2026-10, bucket 16)
  ok   run is not revoked
  ok   recomputed root equals the committed root
  ok   proof depth 4 matches the committed headcount bucket 16
  ok   period 2026-10 matches the commitment
  ok   currency USD matches the commitment
VERIFIED: 5,800.00 USD for 2026-10, paid by acme-payroll.test.near
```

### 3d. tampered amount (expect FAILED, exit 1)

`sed 's/"amount_cents": 580000/"amount_cents": 980000/' out/payslips/payslip-ada-lagos.testnet.json > out/tampered.json && node bin/payslip-proof.js verify-payslip out/tampered.json`

Result: as expected, exit code 1 (expected 1), 0.0 s.

```
chain source: RECORDED  fixtures/chain/sandbox-recorded.json (sandbox, contract payroll-commit.test.near, recorded 2026-11-09T05:21:10.946Z). Not a live chain read.
  note: no live chain reachable (no local sandbox is running), so this answer comes from the recorded fixture. For a live local chain: npm run sandbox
  ok   contract payroll-commit.test.near is the official sandbox contract
  ok   leaf recomputed from the line and its salt: b7c82b488e8d4841...
  ok   4 sibling hashes fold the leaf up to root 263767a2b07395a0...
  ok   commitment found for acme-payroll.test.near / run 2026-10 (period 2026-10, bucket 16)
  ok   run is not revoked
  FAIL recomputed root 263767a2b07395a0... does not equal the committed root 11b07b6364d1dbf8...
  ok   proof depth 4 matches the committed headcount bucket 16
  ok   period 2026-10 matches the commitment
  ok   currency USD matches the commitment
FAILED: recomputed root 263767a2b07395a0... does not equal the committed root 11b07b6364d1dbf8...
```

### 4a. department disclosure pack

`node bin/payslip-proof.js export-disclosure --run out/run/run.private.json --department Engineering --out out/engineering.json --network sandbox && node bin/payslip-proof.js verify-disclosure out/engi...`

Result: as expected, exit code 0 (expected 0), 0.1 s.

```
wrote subset disclosure pack (department=Engineering, 3 lines) to out/engineering.json
chain source: RECORDED  fixtures/chain/sandbox-recorded.json (sandbox, contract payroll-commit.test.near, recorded 2026-11-09T05:21:10.946Z). Not a live chain read.
  note: no live chain reachable (no local sandbox is running), so this answer comes from the recorded fixture. For a live local chain: npm run sandbox
  ok   contract payroll-commit.test.near is the official sandbox contract
  ok   commitment found for acme-payroll.test.near / run 2026-10 (period 2026-10, bucket 16)
  ok   run is not revoked
  ok   3 lines each fold up to the committed root, no duplicates
VERIFIED SUBSET: 3 lines, subtotal 16,250.00 USD for 2026-10, employer acme-payroll.test.near
  not verified: the company total (38,180.00 USD is only the employer's declaration; the other leaves stay hidden)
  not verified: that this list is complete for its selector (an employer could omit a line); only a full audit pack proves completeness
```

### 4b. full audit pack

`node bin/payslip-proof.js export-disclosure --run out/run/run.private.json --all --out out/full.json --network sandbox && node bin/payslip-proof.js verify-disclosure out/full.json`

Result: as expected, exit code 0 (expected 0), 0.1 s.

```
wrote FULL audit pack to out/full.json: it reveals every line and the true headcount to whoever receives it
chain source: RECORDED  fixtures/chain/sandbox-recorded.json (sandbox, contract payroll-commit.test.near, recorded 2026-11-09T05:21:10.946Z). Not a live chain read.
  note: no live chain reachable (no local sandbox is running), so this answer comes from the recorded fixture. For a live local chain: npm run sandbox
  ok   contract payroll-commit.test.near is the official sandbox contract
  ok   commitment found for acme-payroll.test.near / run 2026-10 (period 2026-10, bucket 16)
  ok   run is not revoked
  ok   all 16 leaves rebuild the committed root: nothing is hidden in the tree
  ok   sum of revealed lines equals the declared total 38,180.00 USD
VERIFIED FULL AUDIT: 11 lines (+5 padding leaves) rebuild the on-chain root; total 38,180.00 USD equals the declared total, period 2026-10, employer acme-payroll.test.near
  not verified: that money was actually paid out (the commitment is the employer's attestation, not a settlement receipt)
```

### 5. payout-preview (recorded quotes)

`node bin/payslip-proof.js payout-preview --run out/run/run.private.json`

Result: as expected, exit code 0 (expected 0), 0.0 s.

```
Payout preview for run 2026-10 (acme-payroll.test.near), period 2026-10
RECORDED  dry-run quotes recorded 2026-11-09T05:23:39.793Z (fixtures/intents). Not live prices.
Funding asset: USDC on NEAR, converted by NEAR Intents 1Click. DRY RUN ONLY: no deposit address exists, nothing is sent.
A quote is valid for 10 minutes, so recorded ones are a snapshot, not an offer. Run with --live to price them again.

employee                   pay (USD)  prefers                  would receive    cost    ETA  quote
ada-lagos.testnet           5,800.00  USDC on base         5,799.463154 USDC   0.01%   22 s  expired
bao-hanoi.testnet           4,300.00  USDC on arb          4,299.126143 USDC   0.02%   19 s  expired
carla-lima.testnet          6,150.00  ETH on eth                2.874959 ETH   0.16%   27 s  expired
dmitri-tbilisi.testnet      3,950.00  USDC on near                3,950 USDC   0.00%   20 s  expired
elif-izmir.testnet          3,400.00  USDC on sol          3,399.363004 USDC   0.02%   17 s  expired
farid-baku.testnet          2,850.00  USDC on near                2,850 USDC   0.00%   20 s  expired
grace-nairobi.testnet       2,625.00  USDC on base         2,624.787623 USDC   0.01%   22 s  expired
hiro-osaka.testnet          3,100.00  BTC on btc                0.041502 BTC   0.18%  465 s  expired
ines-porto.testnet          2,150.00  USDC on eth          2,149.287219 USDC   0.03%   27 s  expired
jomo-accra.testnet          1,980.00  USDC on base         1,979.845155 USDC   0.01%   22 s  expired
kamala-pune.testnet         1,875.00  USDC on sol          1,874.672296 USDC   0.02%   17 s  expired

11 of 11 lines priced. "cost" = value in minus value out at the quote's own USD prices (route, fees and slippage), not a promise.
```

### 6. npm run web (server answers for the page and its data)

`(PORT=5188 npm run web > out/web.log 2>&1 & echo $! > out/web.pid); sleep 2; for p in / /app.js /styles.css /core/run.js /core/verify.js /intents/preview.js /data/chain.recorded.json /data/chain.testn...`

Result: as expected, exit code 0 (expected 0), 2.1 s.

```
/ 200
/app.js 200
/styles.css 200
/core/run.js 200
/core/verify.js 200
/intents/preview.js 200
/data/chain.recorded.json 200
/data/chain.testnet.recorded.json 200
/data/quotes.recorded.json 200
/fonts/inter-latin-wght-normal.woff2 200

> payslip-proof@0.1.0 web
> node scripts/serve.mjs

built dist
Payslip Proof is at http://127.0.0.1:5188/  (Ctrl-C to stop)
```

### 7. npm run demo:testnet (read-only, live NEAR testnet)

`npm run demo:testnet`

Result: as expected, exit code 0 (expected 0), 0.6 s.

```

> payslip-proof@0.1.0 demo:testnet
> node scripts/demo-testnet.mjs


== 1. Verify Ada's payslip against the live testnet contract payroll-commit-e0e6ee.testnet

$ payslip-proof verify-payslip samples/testnet/payslips/payslip-ada-lagos.testnet.json --chain testnet
chain source: LIVE  https://test.rpc.fastnear.com (testnet, contract payroll-commit-e0e6ee.testnet)
  ok   contract payroll-commit-e0e6ee.testnet is the official testnet contract
  ok   leaf recomputed from the line and its salt: cb1b21301dee0241...
  ok   4 sibling hashes fold the leaf up to root f4dd0ec067d6d29b...
  ok   commitment found for acme-payroll-e0e6ee.testnet / run 2026-10 (period 2026-10, bucket 16)
  ok   run is not revoked
  ok   recomputed root equals the committed root
  ok   proof depth 4 matches the committed headcount bucket 16
  ok   period 2026-10 matches the commitment
  ok   currency USD matches the commitment
VERIFIED: 5,800.00 USD for 2026-10, paid by acme-payroll-e0e6ee.testnet

== 2. Change the amount: the live check must fail

$ payslip-proof verify-payslip out/demo-testnet/amount-9800.json --chain testnet --brief
chain source: LIVE  https://test.rpc.fastnear.com (testnet, contract payroll-commit-e0e6ee.testnet)
FAILED: recomputed root c6042861e7f79d4e... does not equal the committed root f4dd0ec067d6d29b...
(exit code 1, as expected)

== 3. An auditor checks the Engineering department pack against the same live commitment

$ payslip-proof verify-disclosure samples/testnet/engineering.disclosure.json --chain testnet
... (16 lines omitted) ...
  ok   all 16 leaves rebuild the committed root: nothing is hidden in the tree
  ok   sum of revealed lines equals the declared total 38,180.00 USD
VERIFIED FULL AUDIT: 11 lines (+5 padding leaves) rebuild the on-chain root; total 38,180.00 USD equals the declared total, period 2026-10, employer acme-payroll-e0e6ee.testnet
  not verified: that money was actually paid out (the commitment is the employer's attestation, not a settlement receipt)

On-chain evidence (open in a browser):
  deploy     https://testnet.nearblocks.io/txns/2SeLTSSL3bnG8LwbPiRTrrRwpCwzdRwoCafUxDdUV1F1
  commit_run https://testnet.nearblocks.io/txns/3Q9EgoykTwZxax9DL6CkrrySQPWGeFbETcu5Cs3KGgG9

Testnet demo finished. Everything above was read live from NEAR testnet.
```

### 8a. npm ci

`npm ci`

Result: as expected, exit code 0 (expected 0), 0.4 s.

```

added 21 packages, and audited 22 packages in 401ms

11 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

### 8b. npm run demo:chain (live local sandbox, first run downloads nothing new if cached)

`npm run demo:chain`

Result: as expected, exit code 0 (expected 0), 16.2 s.

```

> payslip-proof@0.1.0 demo:chain
> node scripts/demo-chain.mjs


== 0. Start a local NEAR chain and deploy the payroll-commit contract on it
local NEAR sandbox is up: http://127.0.0.1:40581
contract payroll-commit deployed as payroll-commit.test.near (wasm sha256 241ae90171b4f660...)
state file .sandbox/state.json (throwaway sandbox keys only). Ctrl-C stops the chain and forgets everything.
READY

== 1. Build the run, export payslips, commit the root on chain

$ payslip-proof build-run --input samples/payroll.sample.json --out out/demo-chain/run --seed psp-demo-seed-2026
built run 2026-10 for acme-payroll.test.near, period 2026-10
  lines            : 11 real + 5 random padding leaves = 16 leaves (public bucket: 16)
  declared total   : 38,180.00 USD
  merkle root      : 11b07b6364d1dbf8c17888e82f5147ecffc297782f89f57e7b7d164368cebd12
  private file     : out/demo-chain/run/run.private.json  (secret: holds every salt)
  public commitment: out/demo-chain/run/commitment.json
  NOTE: --seed makes salts and padding deterministic. Use it only for the public sample; real runs omit it.

$ payslip-proof commit --run out/demo-chain/run/run.private.json --network sandbox
committing run 2026-10 as acme-payroll.test.near on sandbox (contract payroll-commit.test.near)
  transaction : iuQPPNGYw1V3Vw4P25npjfJ9Zo4CYn2VaNUEVxujK7h
  on chain    : root 11b07b6364d1dbf8c17888e82f5147ecffc297782f89f57e7b7d164368cebd12
                total 38,180.00 USD, bucket 16, revoked=false
committed

== 2. A landlord verifies the payslip: this time the commitment is read LIVE from the chain
... (34 lines omitted) ...

== 5. The contract refuses an overwrite of a committed run id
Committing the same run again (even revoked) must fail: commitments are immutable, corrections get a new run id.

$ payslip-proof commit --run out/demo-chain/run/run.private.json --network sandbox
committing run 2026-10 as acme-payroll.test.near on sandbox (contract payroll-commit.test.near)
error: the contract refused: this run_id is already committed for your account; commitments are immutable, use a new run_id
(exit code 3, as expected)

Live chain demo finished.
```

### 9. npm run test:contract (cargo-near on PATH)

`npm run test:contract`

Result: as expected, exit code 0 (expected 0), 43.6 s.

```
Running unittests src/lib.rs (contracts/payroll-commit/target/debug/deps/payroll_commit-5aa74567dff8916d)
running 10 tests
test tests::validators ... ok
test tests::storage_must_be_paid - should panic ... ok
test tests::revoke_unknown_run - should panic ... ok
test tests::commit_then_view ... ok
test tests::no_overwrite - should panic ... ok
test tests::unknown_run_is_null ... ok
test tests::same_run_id_for_two_employers_is_two_runs ... ok
test tests::only_the_owner_can_revoke - should panic ... ok
test tests::revoke_keeps_history_and_cannot_repeat ... ok
test tests::rejects_bad_input ... ok
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
     Running tests/sandbox.rs (contracts/payroll-commit/target/debug/deps/sandbox-9650ce4b43352022)
running 4 tests
test caller_pays_for_storage_and_gets_the_rest_back ... ok
test commit_view_revoke_roundtrip ... ok
test invalid_input_is_refused_on_chain ... ok
test cannot_overwrite_and_others_cannot_touch_my_run ... ok
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.31s
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### 10. npm run test:browser (headless Chromium)

`CHROME=/path/to/chrome npm run test:browser`

Result: as expected, exit code 0 (expected 0), 0.8 s.

```

> payslip-proof@0.1.0 test:browser
> node scripts/browser-check.mjs

ok   page boots and loads its recorded data
ok   uploading the real payslip produces a result
ok   genuine payslip: green banner
ok   genuine payslip: shows 5,800.00
ok   genuine payslip: all checks listed as passed
ok   uploading the tampered payslip produces a result
ok   tampered payslip: red banner, no green
ok   uploading a non-JSON file produces a result
ok   non-JSON file: red banner, no crash
ok   uploading a payslip with HTML in a field produces a result
ok   hostile field is shown as text, nothing is injected or executed
ok   revoked example: red
ok   revoked example says the employer revoked the run
ok   testnet example: green
ok   testnet example names its source (LiveCommitment read live, just now, from NEAR testnet throug...)
ok   testnet example is labelled Live (or says the live read failed)
ok   tampered testnet payslip: red
ok   employer view lists the 11 pay lines
ok   employer view: root rebuilt in the browser equals the recorded on-chain root
ok   payouts view shows 11 priced cards
ok   status timeline shows the REFUNDED state

all browser checks passed
```

### 11. npm test again, with node_modules present

`npm test`

Result: as expected, exit code 0 (expected 0), 1.1 s.

```
ok 1 - verify-payslip: verified, exit 0, exact summary line, labelled as recorded when no chain is up
ok 2 - verify-payslip: auto mode falls back to the fixture and says so
ok 3 - verify-payslip: --json is machine readable
ok 4 - verify-payslip: tampered amount exits 1 with FAILED
ok 5 - verify-payslip: a payslip pointing at an unofficial contract is refused
ok 6 - verify-payslip: revoked run (recorded from a real sandbox) exits 1
ok 7 - the recorded fixture still matches a deterministic rebuild of the sample (format drift alarm)
ok 8 - disclosure via the CLI: subset and full audit verify, tampering fails
ok 9 - usage errors exit 2: unknown flag, missing file, bad input, unknown command, mainnet
ok 10 - payout-preview prints a priced line per employee from the recorded quotes and flags them as recorded
ok 11 - no sandbox running: --chain sandbox fails clearly (exit 2) and says how to start one
ok 12 - rpc view: parses a contract answer and maps failures to ChainUnavailable
ok 13 - an independent Python implementation (scripts/reference_verify.py) folds every payslip to the same root
ok 14 - sha256 wrapper agrees with node:crypto
ok 15 - leaf hash known answer (also reproduced by an independent Python script, see docs/SPEC.md)
ok 16 - leaf preimage starts with the domain label and ends with the salt
ok 17 - every committed field changes the leaf hash
ok 18 - length prefixes stop field-boundary tricks
ok 19 - dummy leaves use their own domain
ok 20 - validation rejects malformed lines
ok 21 - formatAmount
ok 22 - merkle: every leaf proves in trees of 1..33 leaves, odd nodes are promoted
ok 23 - merkle: 3-leaf tree promotes the odd leaf unchanged (no duplication)
ok 24 - merkle: a wrong sibling, wrong side or extra step breaks the root
ok 25 - leaf and node hashes are domain separated (an inner node cannot pass as a leaf)
ok 26 - rng: seeded stream is reproducible, unseeded is not
ok 27 - hex helpers are strict
ok 28 - fixtures are labelled and real-shaped
ok 29 - safety: requests are always dry, and the code has no path to a real swap
ok 30 - base units: 1 USD cent of a 6-decimal token is 10^4 units
ok 31 - recorded quotes: 11 sample lines get cards, expired by design, with value and cost
ok 32 - quote expiry: a fresh quote is "quoted", one past its deadline is "expired"
ok 33 - a real API refusal becomes an "unavailable" card with the API message
ok 34 - unknown asset or chain: unavailable, never a made-up amount
ok 35 - status timeline: every status has three steps and an honest next action
ok 36 - testnet payslip with no network: falls back to the recorded testnet answer and says so
ok 37 - testnet payslip with --chain testnet and no network: fails loudly (exit 1), never silently recorded
ok 38 - the testnet disclosure packs verify offline from the recorded answer
ok 39 - payout-preview works with no network (recorded quotes) and --live fails loudly
ok 40 - sample run: deterministic with a seed, random without
ok 41 - sample run: root is pinned (a format change must be a conscious decision)
ok 42 - padding hides the headcount: 11 lines are committed as a bucket of 16, with padding leaves
ok 43 - leaf order is shuffled: tree position does not follow input order
ok 44 - rebuild reproduces the stored root and rejects a doctored private file
ok 45 - input validation: duplicates, mixed currency, wrong period, empty, bad employer
ok 46 - the commitment holds only root, period, currency, total, bucket and identity
ok 47 - disclosure selectors and a selector with no match
ok 48 - happy path: every payslip verifies and prints the contract-specified summary line
ok 49 - tamper: changed amount
ok 50 - tamper: changed salt, department, payout preference, account, period
ok 51 - tamper: wrong sibling hash, flipped side, dropped step, extra step
ok 52 - tamper: wrong employer named in the payslip
ok 53 - tamper: copy-root attack (an impostor commits the same root under their own account)
ok 54 - tamper: wrong run_id and no commitment at all
ok 55 - tamper: revoked run
ok 56 - tamper: committed root or bucket differs from the proof
ok 57 - malformed payslips fail cleanly, never throw
ok 58 - privacy: a payslip carries nothing about anyone else
ok 59 - privacy: the same payroll built twice with real randomness shares no proof hashes
ok 60 - privacy: an unseeded run does not reveal the true headcount in proof length
ok 61 - disclosure subset: verifies and recomputes the subtotal; says what it did not verify
ok 62 - disclosure subset: tampered amount, duplicated line, wrong proof, wrong root all fail
ok 63 - disclosure subset: an omitted line is NOT detected (documented limit)
ok 64 - full audit: rebuilds the on-chain root, total equals the declared total
ok 65 - full audit: hiding a real line behind a padding seed, a changed line, or a wrong declared total all fail
# tests 65
# suites 0
# pass 65
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

