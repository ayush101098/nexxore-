#!/usr/bin/env bash
# make preflight: checks before a demo. Prints PASS / WARN / FAIL per check; exits 1 on any FAIL.
# Run after `make up` and `make demo-reset`.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/addresses.sh"
PY="${RISKPILOT_PYTHON:-$ROOT/.venv/bin/python}"
RPC=http://127.0.0.1:8545
ENGINE=http://127.0.0.1:8000
ARC_RPC="${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}"
ARC_DEP="${ARC_DEPLOYMENT_FILE:-$ROOT/contracts/arc/deployments/arc-testnet.json}"
ARC_USDC=0x3600000000000000000000000000000000000000
FAILS=0
pass() { printf 'PASS  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }
json() { "$PY" -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "== demo chain"
if head=$(cast block-number --rpc-url $RPC 2>/dev/null); then
  frozen=$("$PY" -c "import json; n=json.load(open('$ROOT/demo/frozen/anvil-state.json'))['block']['number']; print(int(n, 16) if isinstance(n, str) else n)" 2>/dev/null || echo "?")
  [ "$head" = "$frozen" ] && pass "anvil up at the frozen block $head" || fail "anvil at block $head, frozen block is $frozen (run make demo-reset)"
  eth=$(cast balance --rpc-url $RPC "$DEMO_WALLET")
  weth=$(cast call --rpc-url $RPC "$WETH" 'balanceOf(address)(uint256)' "$DEMO_WALLET" | awk '{print $1}')
  usdc=$(cast call --rpc-url $RPC "$USDC" 'balanceOf(address)(uint256)' "$DEMO_WALLET" | awk '{print $1}')
  if [ "$eth" = 992000000000000000000 ] && [ "$weth" = 8000000000000000000 ] && [ "$usdc" = 5000000000 ]; then
    pass "demo wallet $DEMO_WALLET: 992 ETH, 8 WETH, 5,000 USDC (as in the snapshot)"
  else fail "demo wallet balances $eth wei, $weth WETH-wei, $usdc USDC units (snapshot: 992 ETH, 8 WETH, 5,000 USDC)"; fi
else
  fail "anvil not answering on $RPC (run make up)"
fi

echo "== engine"
if health=$(curl -sf --max-time 5 $ENGINE/v1/health); then
  st=$(echo "$health" | json 'd["status"]')
  up=$(echo "$health" | json 'd["dependencies"]["chain"]["up"]')
  stream=$(echo "$health" | json 'd["dependencies"]["chain"]["stream"]')
  unavail=$(echo "$health" | json '",".join(d["dependencies"]["sources"]["unavailable"])')
  arcdep=$(echo "$health" | json 'd["dependencies"].get("arc", {}).get("up", "n/a")')
  [ "$st" = ok ] && pass "engine /v1/health status ok" || fail "engine status $st"
  [ "$up" = True ] && pass "dependency chain: up ($stream)" || fail "dependency chain: $up"
  [ -z "$unavail" ] && pass "dependency sources: none unavailable" || fail "dependency sources unavailable: $unavail"
  case "$arcdep" in True|n/a) [ "$arcdep" = True ] && pass "dependency arc: up" ;; *) fail "dependency arc: $arcdep" ;; esac
  echo "$health" | json '"\n".join(d.get("warnings", []))' | while read -r w; do [ -n "$w" ] && warn "engine: $w"; done
else
  fail "engine not answering on $ENGINE (run make up)"
fi

echo "== opportunities"
EXPECTED='Price gap · hooked=APPROVE|Price gap · static=APPROVE|Price gap · v4 ETH/USDC=REJECT|Put-like=REJECT|Call-like=APPROVE'
if opps=$(curl -sf --max-time 10 "$ENGINE/v1/opportunities?wallet=$DEMO_WALLET"); then
  echo "$opps" | EXPECTED="$EXPECTED" "$PY" -c '
import json, os, sys
items = json.load(sys.stdin)["items"]
want = dict(x.split("=") for x in os.environ["EXPECTED"].split("|"))
bad = 0
print(("PASS" if len(items) == 5 else "FAIL") + f"  {len(items)} opportunities seeded (expected 5)")
bad += len(items) != 5
for prefix, verdict in want.items():
    it = next((i for i in items if i["label"].startswith(prefix)), None)
    got = it["decision"]["verdict"] if it else "missing"
    ok = got == verdict
    bad += not ok
    label = it["label"] if it else prefix
    net = it["decision"]["net_edge"] if it else "-"
    print(("PASS" if ok else "FAIL") + f"  {label}: {got} (expected {verdict}), net {net}")
sys.exit(1 if bad else 0)' || FAILS=$((FAILS + 1))
else
  fail "GET /v1/opportunities failed"
fi

echo "== Arc"
if cid=$(cast chain-id --rpc-url "$ARC_RPC" 2>/dev/null); then
  [ "$cid" = 5042002 ] && pass "Arc RPC reachable ($ARC_RPC, chain 5042002)" || fail "Arc RPC chain id $cid, expected 5042002"
else
  fail "Arc RPC not reachable ($ARC_RPC)"
fi
if [ -f "$ARC_DEP" ]; then
  escrow=$("$PY" -c "import json; print(json.load(open('$ARC_DEP'))['escrow'])")
  operator=$("$PY" -c "import json; print(json.load(open('$ARC_DEP'))['operator'])")
  pass "deployments/arc-testnet.json exists (escrow $escrow)"
  code=$(cast code --rpc-url "$ARC_RPC" "$escrow" 2>/dev/null || echo 0x)
  [ ${#code} -gt 4 ] && pass "escrow has code on Arc ($(( (${#code} - 2) / 2 )) bytes)" || fail "no code at $escrow on Arc"
  bal=$(cast call --rpc-url "$ARC_RPC" $ARC_USDC 'balanceOf(address)(uint256)' "$operator" 2>/dev/null | awk '{print $1}')
  if [ -z "$bal" ]; then fail "could not read operator $operator USDC"
  elif [ "$bal" -ge 1000000 ]; then pass "operator $operator holds $("$PY" -c "print(f'{$bal/1e6:,.2f}')") USDC (>= 1)"
  else warn "operator $operator holds $("$PY" -c "print(f'{$bal/1e6:,.6f}')") USDC (below 1)"; fi
else
  fail "deployments/arc-testnet.json missing (make arc-setup SENDER=0x…)"
  fail "operator USDC: no deployment to read the operator from"
fi

echo "== public page"
code=$(curl -s -o /tmp/rp-preflight.html -w '%{http_code}' --max-time 10 "https://nexxore.xyz/riskpilot?readonly=1")
if [ "$code" = 200 ] && grep -q "READ_ONLY" /tmp/rp-preflight.html; then pass "nexxore.xyz/riskpilot answers 200 in read-only mode"
else fail "nexxore.xyz/riskpilot?readonly=1 answered $code"; fi
rm -f /tmp/rp-preflight.html

echo "== repository"
dirty=$(git -C "$ROOT/.." status --porcelain | wc -l | tr -d ' ')
[ "$dirty" = 0 ] && pass "git status clean" || fail "git status: $dirty uncommitted or untracked paths"
envs=$(git -C "$ROOT/.." ls-files | grep -E '(^|/)\.env' | grep -v -E '\.example$' || true)
[ -z "$envs" ] && pass "no tracked .env files" || fail "tracked .env files: $(echo $envs)"

echo
[ "$FAILS" = 0 ] && { echo "preflight: all checks passed"; exit 0; } || { echo "preflight: $FAILS check(s) failed"; exit 1; }
