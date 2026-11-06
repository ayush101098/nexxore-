#!/usr/bin/env bash
# Persistent Anvil fork of Ethereum mainnet at the pinned block with both demo curves shipped.
# First run: fork, fund maker and taker, ship, keep dumping state to demo/anvil-state.json.
# Later runs: reload that state (--state), so the curves and any fills survive restarts.
# Ctrl-C stops Anvil and writes the final state.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${AQUA_FORK_RPC_URL:?set AQUA_FORK_RPC_URL to an Ethereum mainnet archive RPC}"
BLOCK="${AQUA_FORK_BLOCK:-$(sed -nE 's/.*FORK_BLOCK = ([0-9_]+);.*/\1/p' src/DemoParams.sol | tr -d _)}"
PORT="${DEMO_PORT:-8545}"
RPC="http://127.0.0.1:${PORT}"
STATE=demo/anvil-state.json
WETH=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
# Anvil's default dev accounts (public keys from the standard test mnemonic): #0 maker, #1 taker.
MAKER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
TAKER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
# Chain id 31337 so a browser wallet never mistakes the fork for mainnet.
ANVIL_ARGS=(--fork-url "$AQUA_FORK_RPC_URL" --fork-block-number "$BLOCK" --chain-id 31337 --port "$PORT" --state-interval 10)
mkdir -p demo

if [ -f "$STATE" ]; then
  echo "Reloading demo chain from $STATE (fork block $BLOCK) on $RPC"
  exec anvil "${ANVIL_ARGS[@]}" --state "$STATE"
fi

anvil "${ANVIL_ARGS[@]}" --dump-state "$STATE" >demo/anvil.log 2>&1 &
ANVIL=$!
READY=0
# Stop Anvil on exit; if setup never finished, drop the half-built state so a restart starts clean.
cleanup() {
  kill -INT "$ANVIL" 2>/dev/null || true
  wait "$ANVIL" 2>/dev/null || true
  [ "$READY" = 1 ] || rm -f "$STATE" demo/curves.json
}
trap cleanup EXIT
for _ in $(seq 1 120); do cast block-number --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.5; done
cast block-number --rpc-url "$RPC" >/dev/null

MAKER=$(cast wallet address --private-key "$MAKER_PK")
TAKER=$(cast wallet address --private-key "$TAKER_PK")
send() { cast send --rpc-url "$RPC" "$@" >/dev/null; }

echo "Funding ETH and wrapping to WETH"
for A in "$MAKER" "$TAKER"; do cast rpc --rpc-url "$RPC" anvil_setBalance "$A" 0x3635C9ADC5DEA00000 >/dev/null; done  # 1,000 ETH
send --private-key "$MAKER_PK" "$WETH" 'deposit()' --value 6ether  # covers the 5 ETH call-like curve
send --private-key "$TAKER_PK" "$WETH" 'deposit()' --value 5ether

# USDC holder to impersonate. For the pinned block, find_usdc_holder.py found this EOA
# (3.35B USDC at block 26,354,292); for any other block it searches again via the local node.
PINNED_BLOCK=$(sed -nE 's/.*FORK_BLOCK = ([0-9_]+);.*/\1/p' src/DemoParams.sol | tr -d _)
if [ -z "${USDC_HOLDER:-}" ] && [ "$BLOCK" = "$PINNED_BLOCK" ]; then USDC_HOLDER=0x37305b1cd40574e4c5ce33f8e8306be057fd7341; fi
HOLDER="${USDC_HOLDER:-$(python3 script/find_usdc_holder.py "$RPC" "$BLOCK")}"
HELD=$(cast call --rpc-url "$RPC" "$USDC" 'balanceOf(address)(uint256)' "$HOLDER" | awk '{print $1}')
[ "$(echo "$HELD >= 15000000000" | bc)" = 1 ] || { echo "USDC holder $HOLDER has only $HELD units"; exit 1; }
echo "Funding USDC from impersonated holder $HOLDER"
cast rpc --rpc-url "$RPC" anvil_impersonateAccount "$HOLDER" >/dev/null
cast rpc --rpc-url "$RPC" anvil_setBalance "$HOLDER" 0xDE0B6B3A7640000 >/dev/null  # 1 ETH for gas
send --from "$HOLDER" --unlocked "$USDC" 'transfer(address,uint256)' "$MAKER" 5000000000    # 5,000 USDC
send --from "$HOLDER" --unlocked "$USDC" 'transfer(address,uint256)' "$TAKER" 10000000000   # 10,000 USDC
cast rpc --rpc-url "$RPC" anvil_stopImpersonatingAccount "$HOLDER" >/dev/null

echo "Writing demo curves (shipped from the /riskpilot page when the user signs)"
MAKER_PRIVATE_KEY="$MAKER_PK" SHIP=none forge script script/ShipDemoCurves.s.sol --rpc-url "$RPC" -q

cat <<EOF
Demo chain ready on $RPC (Ethereum mainnet fork at block $BLOCK)
  maker $MAKER   taker $TAKER   curves: demo/curves.json
  engine: cd ../../engine && ../.venv/bin/uvicorn main:app   then open http://localhost:8000/riskpilot
  ship from the CLI instead: make demo-ship · fill: make demo-fill CURVE=upside
State is saved to $STATE every 10 s and on Ctrl-C; the next 'make demo-chain' reloads it.
EOF
READY=1
wait "$ANVIL"
