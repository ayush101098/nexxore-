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
# Demo actors (../../scripts/addresses.sh): the owner's address is the demo wallet; the taker is
# a keccak-derived address nobody holds a key for. No Anvil default account is used: both act
# through impersonation, and their balances are set directly (../../scripts/deal.sh).
. ../../scripts/addresses.sh
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

MAKER=$DEMO_WALLET
TAKER=$DEMO_TAKER
echo "Funding the demo wallet and the taker (anvil_setBalance + WETH/USDC storage writes)"
../../scripts/deal.sh "$MAKER" 992 8 5000 "$RPC"     # 8 WETH covers the 7 ETH call-like curve
../../scripts/deal.sh "$TAKER" 1000 5 10000 "$RPC"

echo "Writing demo curves (shipped from the /riskpilot page when the user signs)"
MAKER="$MAKER" SHIP=none forge script script/ShipDemoCurves.s.sol --rpc-url "$RPC" -q

cat <<EOF
Demo chain ready on $RPC (Ethereum mainnet fork at block $BLOCK)
  maker $MAKER   taker $TAKER   curves: demo/curves.json
  engine: cd ../../engine && ../.venv/bin/uvicorn main:app   then open http://localhost:8000/riskpilot
  ship from the CLI instead: make demo-ship · fill: make demo-fill CURVE=upside
State is saved to $STATE every 10 s and on Ctrl-C; the next 'make demo-chain' reloads it.
EOF
READY=1
wait "$ANVIL"
