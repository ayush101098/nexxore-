#!/usr/bin/env python3
"""Print a large USDC-holding EOA at a block, for anvil_impersonateAccount on the demo chain.

Candidates are the counterparties of USDC transfers in the blocks just before
<block>, largest transfers first; the EOA with the largest balance at <block> wins. Nothing is hardcoded.

Usage: find_usdc_holder.py <rpc_url> <block> [min_usdc]
(demo-chain.sh passes the local Anvil fork, which forwards to the remote.)
"""

import json
import sys
import urllib.request

USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"  # Transfer(address,address,uint256)
BALANCE_OF = "0x70a08231"
LOOKBACK = 9  # free-tier RPCs (Alchemy) cap eth_getLogs at a 10-block range
MAX_CANDIDATES = 15


def rpc(url: str, calls: list[tuple[str, list]]) -> list:
    body = [{"jsonrpc": "2.0", "id": i, "method": m, "params": p} for i, (m, p) in enumerate(calls)]
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        replies = sorted(json.load(resp), key=lambda r: r["id"])
    for r in replies:
        if "error" in r:
            raise SystemExit(f"rpc error: {r['error']}")
    return [r["result"] for r in replies]


def main() -> None:
    url, block = sys.argv[1], int(sys.argv[2])
    min_usdc = int(sys.argv[3]) if len(sys.argv) > 3 else 100_000
    tag = hex(block)
    [logs] = rpc(url, [("eth_getLogs", [{"address": USDC, "topics": [TRANSFER],
                                         "fromBlock": hex(block - LOOKBACK), "toBlock": tag}])])
    # Counterparties of the largest transfers are the likeliest large holders; check only those.
    biggest = sorted(logs, key=lambda log: int(log["data"], 16), reverse=True)
    candidates = []
    for log in biggest:
        for topic in log["topics"][1:3]:
            a = "0x" + topic[-40:]
            if a not in candidates:
                candidates.append(a)
    candidates = candidates[:MAX_CANDIDATES]
    if not candidates:
        raise SystemExit("no USDC transfers in the lookback window")

    calls = []
    for a in candidates:
        calls.append(("eth_call", [{"to": USDC, "data": BALANCE_OF + a[2:].rjust(64, "0")}, tag]))
        calls.append(("eth_getCode", [a, tag]))
    results = rpc(url, calls)

    best = None
    for a, balance, code in zip(candidates, results[0::2], results[1::2]):
        if code not in ("0x", "0x0"):
            continue  # EOAs only: impersonating a contract can trip its own logic
        units = int(balance, 16)
        if best is None or units > best[1]:
            best = (a, units)
    if best is None or best[1] < min_usdc * 10**6:
        raise SystemExit(f"no EOA holding >= {min_usdc} USDC among {len(candidates)} candidates")
    print(best[0])
    print(f"# {best[1] / 1e6:,.0f} USDC at block {block}", file=sys.stderr)


if __name__ == "__main__":
    main()
