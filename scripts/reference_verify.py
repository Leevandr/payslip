#!/usr/bin/env python3
"""Independent re-implementation (Python standard library only) of the payslip leaf hash and the Merkle fold.

It exists to show that docs/SPEC.md is enough to rebuild a verifier from scratch, and it is checked against the Node
implementation in `npm test`. It recomputes the root from a payslip file; it does NOT validate field grammar and it
does NOT read the chain. Compare the printed root with the root on chain (npm run psp -- verify-payslip does that).

    python3 scripts/reference_verify.py payslip.json [--root HEX]      exit 0 when --root matches (or is not given)
"""
import hashlib
import json
import struct
import sys


def vb(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack(">I", len(b)) + b


def leaf_hash(p: dict) -> bytes:
    line = p["line"]
    pre = (
        b"PSP/v1/leaf\x00"
        + vb(p["employer"])
        + vb(p["run_id"])
        + vb(line["employee_account"])
        + struct.pack(">Q", line["amount_cents"])
        + vb(line["currency"])
        + vb(line["period"])
        + vb(line.get("department", ""))
        + vb(line["payout_pref"]["chain"])
        + vb(line["payout_pref"]["asset"])
        + bytes.fromhex(p["salt"])
    )
    return hashlib.sha256(pre).digest()


def fold(leaf: bytes, proof: list) -> bytes:
    h = leaf
    for step in proof:
        sib = bytes.fromhex(step["hash"])
        pair = sib + h if step["side"] == "left" else h + sib
        h = hashlib.sha256(b"PSP/v1/node\x00" + pair).digest()
    return h


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    payslip = json.load(open(args[0]))
    root = fold(leaf_hash(payslip), payslip["proof"]).hex()
    print(root)
    if "--root" in args:
        want = args[args.index("--root") + 1].lower()
        print("MATCH" if root == want else "MISMATCH")
        return 0 if root == want else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
