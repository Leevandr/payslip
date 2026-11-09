# Payslip Proof format v1

This is everything needed to write a second, independent verifier. `scripts/reference_verify.py` is one (about 50 lines of Python standard library); `npm test` checks that it folds every sample payslip to the same root as the Node code.

## 1. Pay line

A line is `{ employee_account, amount_cents, currency, period, department, payout_pref: { chain, asset } }` plus a 32-byte random `salt`.

| Field | Rule |
|---|---|
| `employee_account` | NEAR account id grammar, 2 to 64 characters |
| `amount_cents` | positive integer, at most 2^53-1, in minor units of `currency` |
| `currency` | three capital letters (ISO 4217 style); one currency per run |
| `period` | `YYYY-MM`; every line of a run has the run's period |
| `department` | 0 to 40 characters of `A-Z a-z 0-9 space . _ & / -`; empty allowed |
| `payout_pref.chain` | 2 to 16 characters of `a-z 0-9` (a 1Click blockchain id such as `base`, `near`, `btc`) |
| `payout_pref.asset` | 1 to 16 characters of `A-Z a-z 0-9 . _ -` (a 1Click symbol such as `USDC`) |

Every text field is limited to a small ASCII set on purpose: two different inputs can never normalise to the same bytes. Unknown fields are rejected, not ignored.

## 2. Leaf hash

```
leaf = SHA-256( "PSP/v1/leaf" 0x00
                || vb(employer) || vb(run_id)
                || vb(employee_account) || u64be(amount_cents) || vb(currency)
                || vb(period) || vb(department)
                || vb(payout_pref.chain) || vb(payout_pref.asset)
                || salt[32] )
vb(x) = u32be(byte length of x) || UTF-8 bytes of x
```

`employer` and `run_id` are inside the leaf (context binding). Without them, anyone could copy a published root, commit it under their own account, and present the genuine payslip as "paid by" themselves.

Known answer (also in `test/core.test.js`): employer `acme-payroll.test.near`, run `2026-10`, line `ada-lagos.testnet`, 580000 cents, `USD`, `2026-10`, `Engineering`, `base`/`USDC`, salt of 32 bytes `0x07` gives leaf `8d67b8dd60d25c9394f7f26d4b7a9b2d22f3372dc635408017b0680cfd27dec9`.

## 3. Padding leaf

```
padding_leaf = SHA-256( "PSP/v1/dummy" 0x00 || seed[32] )
```

A padding leaf is 32 bytes that look like any other leaf. The seed is kept by the employer, so in a full audit the employer can prove a leaf is padding and not a hidden pay line (the domain labels differ, so no pay line can equal a padding leaf).

## 4. Tree

```
node = SHA-256( "PSP/v1/node" 0x00 || left[32] || right[32] )
```

Plain binary Merkle tree. **There are no sums in the tree**: an inner node is only a hash, so a sibling hash never leaks a neighbour's pay. If a level has an odd number of nodes, the last one is promoted unchanged to the next level (it is never duplicated). The builder always pads to a power of two, so promotion only matters for third-party trees.

The builder takes the real lines, adds padding leaves up to the next power of two (minimum 8) and **shuffles all leaves with the CSPRNG** before building the tree. The result is the public *headcount bucket* `B` (8, 16, 32, ...). A proof therefore has exactly `log2(B)` steps and its left/right pattern reveals only a random position.

## 5. Payslip file (`payslip-proof/payslip/v1`)

```json
{
  "format": "payslip-proof/payslip/v1",
  "employer": "acme-payroll.test.near",
  "run_id": "2026-10",
  "network": { "name": "sandbox", "contract": "payroll-commit.test.near" },
  "line": { "employee_account": "...", "amount_cents": 580000, "currency": "USD", "period": "2026-10", "department": "Engineering", "payout_pref": { "chain": "base", "asset": "USDC" } },
  "salt": "<64 hex>",
  "proof": [ { "side": "right", "hash": "<64 hex>" }, ... ]
}
```

`side` is where the sibling sits. To verify: recompute the leaf, fold it with the proof, read `get_run(employer, run_id)` from the contract, and check:

1. the contract is the official one for `network.name`;
2. a record exists and `revoked` is false;
3. the folded root equals `record.root`;
4. `proof.length == log2(record.headcount_bucket)`;
5. `line.period == record.period` and `line.currency == record.currency`.

## 6. On-chain record (`get_run`)

```json
{ "employer": "acme-payroll.test.near", "run_id": "2026-10", "root": "<64 hex>", "period": "2026-10", "currency": "USD",
  "declared_total_cents": "3818000", "headcount_bucket": 16, "committed_at_ms": "1794201662501",
  "revoked": false, "revoked_at_ms": null }
```

`commit_run(run_id, root, period, currency, declared_total_cents, headcount_bucket)` stores it under (calling account, `run_id`). It cannot overwrite, only the owner can `revoke_run(run_id)`, and a revoked run keeps its record.

## 7. Disclosure packs (`payslip-proof/disclosure/v1`)

* **subset**: a list of `{ line, salt, proof }`. The verifier checks each line folds to the committed root, rejects duplicates, and recomputes the subtotal. It says plainly that it did not verify the company total and cannot know whether the subset is complete.
* **full**: every leaf in tree order, either `{ kind: "line", line, salt }` or `{ kind: "dummy", seed }`. The verifier rebuilds the whole tree from the revealed leaves, compares the root with the chain, and compares the sum of the lines with `declared_total_cents`. This is the only way to check a company total, and it reveals every line and the true headcount to the auditor. It is not zero-knowledge.

## 8. What each party learns

| | Learns | Does not learn |
|---|---|---|
| **Anyone reading the chain** | root, period, currency, declared total, headcount bucket, employer account, commit/revoke times | any name, any individual amount, the true headcount (only that it is at most B, and more than B/2 once B is above 8) |
| **Holder of one payslip** | their own line and salt, `log2(B)` sibling hashes, the position of their leaf (random) | any other line, any other amount, how many leaves are padding |
| **Auditor with a subset pack** | the listed lines, their subtotal | the other lines; whether the subset is complete |
| **Auditor with a full pack** | everything in the run, including true headcount | nothing is hidden from them (by design) |

What is **not** hidden: the declared total and the bucket are public, so the average pay per head is bounded; the employer account and commit time are public; anyone holding a payslip learns the employer and the department field of their own line; a payslip holder can show it to others.

What a commitment does **not** prove: that money was paid, or that the lines match any bank record. It is the employer account's attestation. A landlord must trust that the employer account really belongs to the employer (check it out of band).

## 9. Deviations from the written design (flaws found and fixed)

| # | Flaw in the plain design | Fix |
|---|---|---|
| 1 | A published root could be copied under an impostor's account and a genuine payslip presented as theirs | `employer` and `run_id` are part of every leaf |
| 2 | Leaf position (the left/right pattern of the proof) would follow input order and could leak who or how much if the list is sorted | leaves, padding included, are shuffled with the CSPRNG |
| 3 | Random padding hashes could never be shown to be padding, so a full audit could not prove nothing is hidden | padding leaves have a domain-separated seed that the employer reveals in a full audit |
| 4 | The proof length was unchecked | it must equal `log2(headcount_bucket)` |
| 5 | The line had no field to select "one department" in a verifiable way | optional `department` is committed inside the leaf |
| 6 | A declared total has no meaning without a unit | one currency per run, stored on chain; `commit_run` takes `currency` and `headcount_bucket` in addition to the four fields of the written signature |
| 7 | A public contract that pays for storage can be drained by junk commits | `commit_run` is `payable`: the caller pays for the bytes it stores and the rest is refunded |
| 8 | A malicious payslip could point at a contract that answers whatever it likes | the verifier only trusts the official contract per network (`config/networks.json`), unless you pass `--contract` and it says so |
| 9 | A pack could list the same leaf twice to inflate a subtotal | duplicates are rejected |
| 10 | Two lines for one person in one run make "one payslip per employee" ambiguous | duplicate `employee_account` in a run is rejected; merge pay into one line |
