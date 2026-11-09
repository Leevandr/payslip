//! Integration tests on a local NEAR sandbox (real nearcore, real wasm, real gas and storage accounting).
//! Needs `cargo-near` on PATH: near-workspaces calls `cargo near build` to compile this crate.
use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract};
use serde_json::{Value, json};

const ROOT: &str = "11b07b6364d1dbf8c17888e82f5147ecffc297782f89f57e7b7d164368cebd12";

async fn setup() -> Result<(near_workspaces::Worker<near_workspaces::network::Sandbox>, Contract, Account, Account), Box<dyn std::error::Error>> {
    let sandbox = near_workspaces::sandbox().await?;
    let wasm = near_workspaces::compile_project("./").await?;
    let contract = sandbox.dev_deploy(&wasm).await?;
    let employer = sandbox.dev_create_account().await?;
    let other = sandbox.dev_create_account().await?;
    Ok((sandbox, contract, employer, other))
}

fn commit_args(run_id: &str, root: &str) -> Value {
    json!({
        "run_id": run_id, "root": root, "period": "2026-10", "currency": "USD",
        "declared_total_cents": "3818000", "headcount_bucket": 16
    })
}

async fn get_run(contract: &Contract, employer: &Account, run_id: &str) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(contract
        .view("get_run")
        .args_json(json!({ "employer": employer.id(), "run_id": run_id }))
        .await?
        .json::<Value>()?)
}

fn failure_text(outcome: &near_workspaces::result::ExecutionFinalResult) -> String {
    format!("{:?}", outcome.failures())
}

#[tokio::test]
async fn commit_view_revoke_roundtrip() -> Result<(), Box<dyn std::error::Error>> {
    let (_sb, contract, employer, _other) = setup().await?;

    // nothing yet
    assert_eq!(get_run(&contract, &employer, "2026-10").await?, Value::Null);

    let outcome = employer
        .call(contract.id(), "commit_run")
        .args_json(commit_args("2026-10", ROOT))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?;
    assert!(outcome.is_success(), "{}", failure_text(&outcome));

    let run = get_run(&contract, &employer, "2026-10").await?;
    assert_eq!(run["employer"], json!(employer.id()));
    assert_eq!(run["root"], ROOT);
    assert_eq!(run["period"], "2026-10");
    assert_eq!(run["currency"], "USD");
    assert_eq!(run["declared_total_cents"], "3818000");
    assert_eq!(run["headcount_bucket"], 16);
    assert_eq!(run["revoked"], false);
    assert_eq!(run["revoked_at_ms"], Value::Null);

    // the event line is there for indexers
    let logs = outcome.logs().join("\n");
    assert!(logs.contains("EVENT_JSON") && logs.contains("run_committed"), "{logs}");

    // revoke keeps the record
    let revoked = employer
        .call(contract.id(), "revoke_run")
        .args_json(json!({ "run_id": "2026-10" }))
        .transact()
        .await?;
    assert!(revoked.is_success(), "{}", failure_text(&revoked));
    let run = get_run(&contract, &employer, "2026-10").await?;
    assert_eq!(run["revoked"], true);
    assert_eq!(run["root"], ROOT, "history is kept");
    assert!(run["revoked_at_ms"].is_string());
    Ok(())
}

#[tokio::test]
async fn cannot_overwrite_and_others_cannot_touch_my_run() -> Result<(), Box<dyn std::error::Error>> {
    let (_sb, contract, employer, other) = setup().await?;
    let deposit = NearToken::from_millinear(10);
    assert!(employer.call(contract.id(), "commit_run").args_json(commit_args("r1", ROOT)).deposit(deposit).transact().await?.is_success());

    // same account, same run id, different root: refused
    let again = employer.call(contract.id(), "commit_run").args_json(commit_args("r1", &"ab".repeat(32))).deposit(deposit).transact().await?;
    assert!(again.is_failure());
    assert!(failure_text(&again).contains("already committed"), "{}", failure_text(&again));
    assert_eq!(get_run(&contract, &employer, "r1").await?["root"], ROOT);

    // another account cannot revoke it (it has no run called r1 under its own name)
    let steal = other.call(contract.id(), "revoke_run").args_json(json!({ "run_id": "r1" })).transact().await?;
    assert!(steal.is_failure());
    assert!(failure_text(&steal).contains("no run with this run_id for your account"), "{}", failure_text(&steal));
    assert_eq!(get_run(&contract, &employer, "r1").await?["revoked"], false);

    // another account committing "r1" creates its OWN run, and mine is untouched
    assert!(other.call(contract.id(), "commit_run").args_json(commit_args("r1", &"cd".repeat(32))).deposit(deposit).transact().await?.is_success());
    assert_eq!(get_run(&contract, &other, "r1").await?["root"], "cd".repeat(32));
    assert_eq!(get_run(&contract, &employer, "r1").await?["root"], ROOT);

    // revoking twice fails
    assert!(employer.call(contract.id(), "revoke_run").args_json(json!({ "run_id": "r1" })).transact().await?.is_success());
    let twice = employer.call(contract.id(), "revoke_run").args_json(json!({ "run_id": "r1" })).transact().await?;
    assert!(twice.is_failure());
    assert!(failure_text(&twice).contains("already revoked"));
    Ok(())
}

#[tokio::test]
async fn caller_pays_for_storage_and_gets_the_rest_back() -> Result<(), Box<dyn std::error::Error>> {
    let (_sb, contract, employer, _other) = setup().await?;

    // no deposit: refused
    let free = employer.call(contract.id(), "commit_run").args_json(commit_args("r1", ROOT)).transact().await?;
    assert!(free.is_failure());
    assert!(failure_text(&free).contains("attach at least"), "{}", failure_text(&free));
    assert_eq!(get_run(&contract, &employer, "r1").await?, Value::Null);

    // a generous deposit: the unused part comes back
    let before = employer.view_account().await?.balance;
    let outcome = employer.call(contract.id(), "commit_run").args_json(commit_args("r1", ROOT)).deposit(NearToken::from_near(1)).transact().await?;
    assert!(outcome.is_success(), "{}", failure_text(&outcome));
    let after = employer.view_account().await?.balance;
    let spent = before.as_yoctonear() - after.as_yoctonear();
    // storage (~0.003 NEAR) + gas (< 0.01 NEAR), definitely not the full 1 NEAR
    assert!(spent < NearToken::from_millinear(50).as_yoctonear(), "spent {spent} yoctoNEAR; the refund did not arrive");
    assert!(spent > 0);
    Ok(())
}

#[tokio::test]
async fn invalid_input_is_refused_on_chain() -> Result<(), Box<dyn std::error::Error>> {
    let (_sb, contract, employer, _other) = setup().await?;
    let deposit = NearToken::from_millinear(10);
    for args in [
        json!({"run_id":"r1","root":"nothex","period":"2026-10","currency":"USD","declared_total_cents":"1","headcount_bucket":16}),
        json!({"run_id":"r1","root":ROOT,"period":"2026-99","currency":"USD","declared_total_cents":"1","headcount_bucket":16}),
        json!({"run_id":"r1","root":ROOT,"period":"2026-10","currency":"USD","declared_total_cents":"1","headcount_bucket":12}),
        json!({"run_id":"bad id","root":ROOT,"period":"2026-10","currency":"USD","declared_total_cents":"1","headcount_bucket":16}),
    ] {
        let o = employer.call(contract.id(), "commit_run").args_json(args.clone()).deposit(deposit).transact().await?;
        assert!(o.is_failure(), "accepted {args}");
    }
    Ok(())
}
