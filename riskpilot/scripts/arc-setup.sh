#!/usr/bin/env bash
# make arc-setup SENDER=0xYourAddress: Arc testnet escrow, ready for the arc-worker.
#   1. a fresh operator key in .secrets/arc-operator.key (gitignored, mode 600; never your key)
#   2. deploy RiskPilotEscrow with that operator, signed by YOUR wallet (writes deployments/arc-testnet.json)
#   3. send the operator 1 USDC of Arc gas (native USDC, 18 dp)
#   4. approve and fund a 1 USDC reserve (ERC-20 USDC, 6 dp), so winning payouts can settle
# Steps 2–4 are signed by your wallet: forge/cast prompt for it (WALLET=--interactive by default;
# WALLET="--account <keystore>" or --ledger also work). Nothing of yours is stored.
# Re-running reuses the operator key and skips the deploy if deployments/arc-testnet.json exists.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SENDER="${1:?usage: arc-setup.sh 0xYourAddress}"
WALLET="${WALLET:---interactive}"
ARC_RPC="${ARC_RPC:-${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}}"
USDC=0x3600000000000000000000000000000000000000
DEP="${ARC_DEPLOYMENT_FILE:-$ROOT/contracts/arc/deployments/arc-testnet.json}"
KEY="${ARC_OPERATOR_KEY_FILE:-$ROOT/.secrets/arc-operator.key}"
GAS_USDC="${ARC_OPERATOR_GAS:-1}"   # native USDC for the operator's settle() gas
RESERVE_USDC="${ARC_RESERVE:-1}"    # escrow reserve that tops up winning payouts
log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }

[ "$(cast chain-id --rpc-url "$ARC_RPC")" = 5042002 ] || { echo "not Arc testnet: $ARC_RPC" >&2; exit 1; }
mkdir -p "$(dirname "$KEY")" && chmod 700 "$(dirname "$KEY")"
if [ ! -s "$KEY" ]; then
  (umask 077; cast wallet new --json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["private_key"])' >"$KEY")
  log "new operator key in $KEY"
fi
OPERATOR=$(cast wallet address --private-key "$(cat "$KEY")")
log "operator $OPERATOR"

if [ -f "$DEP" ]; then
  log "escrow already deployed: $(python3 -c "import json; print(json.load(open('$DEP'))['escrow'])") (delete $DEP to redeploy)"
else
  log "1/4 deploy RiskPilotEscrow from $SENDER (your wallet signs)"
  (cd "$ROOT/contracts/arc" && OPERATOR_ADDRESS=$OPERATOR ARC_DEPLOYMENT_OUT="$DEP" forge script script/DeployEscrow.s.sol \
    --rpc-url "$ARC_RPC" --sender "$SENDER" $WALLET --broadcast -q)
  python3 "$ROOT/contracts/arc/script/record_deploy_tx.py" \
    "$ROOT/contracts/arc/broadcast/DeployEscrow.s.sol/5042002/run-latest.json" "$DEP"
fi
ESCROW=$(python3 -c "import json; print(json.load(open('$DEP'))['escrow'])")
[ "$(python3 -c "import json; print(json.load(open('$DEP'))['operator'].lower())")" = "$(echo "$OPERATOR" | tr A-F a-f)" ] \
  || { echo "deployments/arc-testnet.json has a different operator than .secrets/arc-operator.key" >&2; exit 1; }

send() { cast send --rpc-url "$ARC_RPC" --from "$SENDER" $WALLET "$@" >/dev/null; }
units() { python3 -c "from decimal import Decimal; print(int(Decimal('$1') * 10**$2))"; }
have=$(cast balance --rpc-url "$ARC_RPC" "$OPERATOR")
if [ "$have" -lt "$(units "$GAS_USDC" 18)" ]; then
  log "2/4 send the operator $GAS_USDC USDC of gas"
  send "$OPERATOR" --value "$(units "$GAS_USDC" 18)"
fi
reserve=$(cast call --rpc-url "$ARC_RPC" "$ESCROW" 'reserve()(uint256)' | awk '{print $1}')
if [ "$reserve" -lt "$(units "$RESERVE_USDC" 6)" ]; then
  log "3/4 approve $RESERVE_USDC USDC for the reserve"
  send "$USDC" 'approve(address,uint256)' "$ESCROW" "$(units "$RESERVE_USDC" 6)"
  log "4/4 fund the reserve"
  send "$ESCROW" 'fundReserve(uint256)' "$(units "$RESERVE_USDC" 6)"
fi
log "escrow $ESCROW · operator $OPERATOR holds $(cast balance --rpc-url "$ARC_RPC" "$OPERATOR" -e) USDC gas · reserve $(cast call --rpc-url "$ARC_RPC" "$ESCROW" 'reserve()(uint256)' | awk '{print $1/1e6}') USDC"
log "done: make up (or make demo-reset) starts the engine with the arc-worker; Approve and sign now funds on Arc"
