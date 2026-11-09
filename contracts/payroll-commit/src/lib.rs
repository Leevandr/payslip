//! payroll-commit: employer-owned commitments for payroll runs.
//!
//! An employer account commits the Merkle root of a payroll run (plus period, currency, declared
//! total and a headcount bucket). Anyone can read the commitment with the `get_run` view. The
//! contract never sees a pay line, a name or a salary: it stores a hash and four public numbers.
//!
//! Rules enforced here:
//!   * a run is stored under (calling account, run_id), so only that account can create or revoke it
//!   * a run id can never be overwritten; a correction is a new run id
//!   * `revoke_run` marks the run revoked and keeps the record (history is never deleted)
//!   * `commit_run` is payable: the caller pays for the storage it uses, the rest is refunded, so
//!     nobody can drain the contract account by writing junk
use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, NearToken, Promise, env, near, require};

const MIN_BUCKET: u32 = 8;
const MAX_BUCKET: u32 = 1 << 20;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Runs,
}

/// Stored form. `revoked_at_ms == 0` means "not revoked" (block timestamps are never 0), so revoking
/// does not change the record size and costs no extra storage.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Run {
    root: String,
    period: String,
    currency: String,
    declared_total_cents: u64,
    headcount_bucket: u32,
    committed_at_ms: u64,
    revoked_at_ms: u64,
}

/// What `get_run` returns.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct RunView {
    pub employer: AccountId,
    pub run_id: String,
    pub root: String,
    pub period: String,
    pub currency: String,
    pub declared_total_cents: U64,
    pub headcount_bucket: u32,
    pub committed_at_ms: U64,
    pub revoked: bool,
    pub revoked_at_ms: Option<U64>,
}

#[near(contract_state)]
pub struct PayrollCommit {
    runs: LookupMap<String, Run>,
}

impl Default for PayrollCommit {
    fn default() -> Self {
        Self {
            runs: LookupMap::new(StorageKey::Runs),
        }
    }
}

/// '|' cannot appear in a NEAR account id or in a validated run id, so the key is unambiguous.
fn key(employer: &AccountId, run_id: &str) -> String {
    format!("{employer}|{run_id}")
}

fn valid_run_id(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && b[0].is_ascii_alphanumeric()
        && b.iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
}

fn valid_root(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn valid_period(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && matches!(&s[5..], "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12")
}

fn valid_currency(s: &str) -> bool {
    s.len() == 3 && s.bytes().all(|c| c.is_ascii_uppercase())
}

fn view(employer: &AccountId, run_id: &str, r: &Run) -> RunView {
    RunView {
        employer: employer.clone(),
        run_id: run_id.to_string(),
        root: r.root.clone(),
        period: r.period.clone(),
        currency: r.currency.clone(),
        declared_total_cents: U64(r.declared_total_cents),
        headcount_bucket: r.headcount_bucket,
        committed_at_ms: U64(r.committed_at_ms),
        revoked: r.revoked_at_ms != 0,
        revoked_at_ms: (r.revoked_at_ms != 0).then_some(U64(r.revoked_at_ms)),
    }
}

fn emit(event: &str, employer: &AccountId, run_id: &str, root: &str) {
    // NEP-297 event envelope, so indexers can follow commitments without calling the view.
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({
            "standard": "payslip_proof",
            "version": "1.0.0",
            "event": event,
            "data": [{ "employer": employer, "run_id": run_id, "root": root }],
        })
    ));
}

#[near]
impl PayrollCommit {
    /// Commit a payroll run under the calling account. Attach a small deposit (0.01 NEAR is plenty):
    /// it pays for the storage of the record and the unused part is refunded.
    #[payable]
    pub fn commit_run(
        &mut self,
        run_id: String,
        root: String,
        period: String,
        currency: String,
        declared_total_cents: U64,
        headcount_bucket: u32,
    ) -> RunView {
        require!(valid_run_id(&run_id), "run_id must be 1-64 chars of A-Z a-z 0-9 . _ - starting with a letter or digit");
        require!(valid_root(&root), "root must be 64 lowercase hex characters (a SHA-256 Merkle root)");
        require!(valid_period(&period), "period must be YYYY-MM");
        require!(valid_currency(&currency), "currency must be 3 uppercase letters");
        require!(declared_total_cents.0 > 0, "declared_total_cents must be greater than zero");
        require!(
            headcount_bucket.is_power_of_two() && (MIN_BUCKET..=MAX_BUCKET).contains(&headcount_bucket),
            "headcount_bucket must be a power of two between 8 and 1048576"
        );

        let employer = env::predecessor_account_id();
        let k = key(&employer, &run_id);
        require!(
            !self.runs.contains_key(&k),
            "this run_id is already committed for your account; commitments are immutable, use a new run_id"
        );

        let before = env::storage_usage();
        let record = Run {
            root,
            period,
            currency,
            declared_total_cents: declared_total_cents.0,
            headcount_bucket,
            committed_at_ms: env::block_timestamp_ms(),
            revoked_at_ms: 0,
        };
        let out = view(&employer, &run_id, &record);
        self.runs.insert(k, record);
        self.runs.flush(); // write now, so storage_usage() below includes this record
        let used = env::storage_usage().saturating_sub(before);
        let cost = env::storage_byte_cost().saturating_mul(u128::from(used));
        let attached = env::attached_deposit();
        require!(
            attached >= cost,
            format!("attach at least {cost} yoctoNEAR to pay for the {used} bytes of storage (attached {attached})")
        );
        let refund = attached.saturating_sub(cost);
        if refund > NearToken::from_yoctonear(0) {
            Promise::new(employer.clone()).transfer(refund).detach();
        }
        emit("run_committed", &employer, &run_id, &out.root);
        out
    }

    /// Mark a run revoked. The record stays; verifiers see `revoked: true` and reject its payslips.
    /// Only the account that committed the run can revoke it.
    pub fn revoke_run(&mut self, run_id: String) -> RunView {
        let employer = env::predecessor_account_id();
        let k = key(&employer, &run_id);
        let record = self
            .runs
            .get_mut(&k)
            .unwrap_or_else(|| env::panic_str("no run with this run_id for your account"));
        require!(record.revoked_at_ms == 0, "run is already revoked");
        record.revoked_at_ms = env::block_timestamp_ms();
        let out = view(&employer, &run_id, record);
        emit("run_revoked", &employer, &run_id, &out.root);
        out
    }

    /// The commitment for (employer, run_id), or null.
    pub fn get_run(&self, employer: AccountId, run_id: String) -> Option<RunView> {
        self.runs.get(&key(&employer, &run_id)).map(|r| view(&employer, &run_id, r))
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[cfg(test)]
mod tests {
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::testing_env;

    use super::*;

    const ROOT: &str = "11b07b6364d1dbf8c17888e82f5147ecffc297782f89f57e7b7d164368cebd12";

    fn ctx(caller: AccountId, deposit_milli: u128, ts_ns: u64) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0))
            .signer_account_id(caller.clone())
            .predecessor_account_id(caller)
            .attached_deposit(NearToken::from_millinear(deposit_milli))
            .block_timestamp(ts_ns);
        b
    }

    fn commit(c: &mut PayrollCommit, id: &str) -> RunView {
        c.commit_run(id.into(), ROOT.into(), "2026-10".into(), "USD".into(), U64(3_818_000), 16)
    }

    #[test]
    fn commit_then_view() {
        testing_env!(ctx(accounts(1), 10, 5_000_000_000).build());
        let mut c = PayrollCommit::default();
        let out = commit(&mut c, "2026-10");
        assert_eq!(out.employer, accounts(1));
        let got = c.get_run(accounts(1), "2026-10".into()).unwrap();
        assert_eq!(got, out);
        assert_eq!(got.root, ROOT);
        assert_eq!(got.declared_total_cents, U64(3_818_000));
        assert_eq!(got.headcount_bucket, 16);
        assert_eq!(got.committed_at_ms, U64(5_000));
        assert!(!got.revoked);
        assert_eq!(got.revoked_at_ms, None);
    }

    #[test]
    fn unknown_run_is_null() {
        testing_env!(ctx(accounts(1), 0, 1).build());
        let c = PayrollCommit::default();
        assert!(c.get_run(accounts(1), "nope".into()).is_none());
    }

    #[test]
    #[should_panic(expected = "already committed")]
    fn no_overwrite() {
        testing_env!(ctx(accounts(1), 10, 1).build());
        let mut c = PayrollCommit::default();
        commit(&mut c, "r1");
        c.commit_run("r1".into(), "ab".repeat(32), "2026-10".into(), "USD".into(), U64(1), 8);
    }

    #[test]
    fn same_run_id_for_two_employers_is_two_runs() {
        testing_env!(ctx(accounts(1), 10, 1).build());
        let mut c = PayrollCommit::default();
        commit(&mut c, "r1");
        testing_env!(ctx(accounts(2), 10, 1).build());
        c.commit_run("r1".into(), "ab".repeat(32), "2026-10".into(), "USD".into(), U64(7), 8);
        assert_eq!(c.get_run(accounts(1), "r1".into()).unwrap().root, ROOT);
        assert_eq!(c.get_run(accounts(2), "r1".into()).unwrap().root, "ab".repeat(32));
    }

    #[test]
    #[should_panic(expected = "no run with this run_id for your account")]
    fn only_the_owner_can_revoke() {
        testing_env!(ctx(accounts(1), 10, 1).build());
        let mut c = PayrollCommit::default();
        commit(&mut c, "r1");
        testing_env!(ctx(accounts(2), 0, 1).build());
        c.revoke_run("r1".into());
    }

    #[test]
    fn revoke_keeps_history_and_cannot_repeat() {
        testing_env!(ctx(accounts(1), 10, 1_000_000).build());
        let mut c = PayrollCommit::default();
        commit(&mut c, "r1");
        testing_env!(ctx(accounts(1), 0, 9_000_000_000).build());
        let out = c.revoke_run("r1".into());
        assert!(out.revoked);
        let got = c.get_run(accounts(1), "r1".into()).unwrap();
        assert!(got.revoked);
        assert_eq!(got.revoked_at_ms, Some(U64(9_000)));
        assert_eq!(got.root, ROOT, "the record is kept");
        let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            testing_env!(ctx(accounts(1), 0, 9_000_000_001).build());
            c.revoke_run("r1".into());
        }));
        assert!(again.is_err());
    }

    #[test]
    #[should_panic(expected = "no run with this run_id")]
    fn revoke_unknown_run() {
        testing_env!(ctx(accounts(1), 0, 1).build());
        PayrollCommit::default().revoke_run("ghost".into());
    }

    #[test]
    #[should_panic(expected = "attach at least")]
    fn storage_must_be_paid() {
        testing_env!(ctx(accounts(1), 0, 1).build());
        commit(&mut PayrollCommit::default(), "r1");
    }

    #[test]
    fn rejects_bad_input() {
        let upper = "AB".repeat(32);
        let bad: Vec<(&str, &str, &str, &str, u64, u32)> = vec![
            ("", ROOT, "2026-10", "USD", 1, 8),
            ("-start", ROOT, "2026-10", "USD", 1, 8),
            ("has|pipe", ROOT, "2026-10", "USD", 1, 8),
            ("ok", "ABCD", "2026-10", "USD", 1, 8),
            ("ok", &upper, "2026-10", "USD", 1, 8),
            ("ok", ROOT, "2026-13", "USD", 1, 8),
            ("ok", ROOT, "2026-1", "USD", 1, 8),
            ("ok", ROOT, "2026-10", "usd", 1, 8),
            ("ok", ROOT, "2026-10", "USDX", 1, 8),
            ("ok", ROOT, "2026-10", "USD", 0, 8),
            ("ok", ROOT, "2026-10", "USD", 1, 4),
            ("ok", ROOT, "2026-10", "USD", 1, 12),
            ("ok", ROOT, "2026-10", "USD", 1, 1 << 21),
        ];
        for (id, root, period, cur, total, bucket) in bad {
            let r = std::panic::catch_unwind(|| {
                testing_env!(ctx(accounts(1), 10, 1).build());
                PayrollCommit::default().commit_run(id.into(), root.into(), period.into(), cur.into(), U64(total), bucket)
            });
            assert!(r.is_err(), "accepted bad input {id:?} {root:?} {period:?} {cur:?} {total} {bucket}");
        }
    }

    #[test]
    fn validators() {
        assert!(valid_run_id("2026-10") && valid_run_id("a") && valid_run_id(&"x".repeat(64)));
        assert!(!valid_run_id(&"x".repeat(65)));
        assert!(valid_period("2026-01") && valid_period("1999-12") && !valid_period("2026-00"));
        assert!(valid_root(ROOT) && !valid_root(&ROOT[..63]));
    }
}
