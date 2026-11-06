#!/usr/bin/env bash
# The local stack: demo chain (:8545), engine (:8000, serves /riskpilot), optional Arc stand-in (:8547).
#   up       start everything (from demo/frozen/ when it exists, else build the chain and freeze it)
#   down     stop everything
#   reset    down, then up from the frozen chain state and SQLite copy; checks the decision ids match
#   restart-engine   restart only the engine (same DB), e.g. to show the arc-worker's catch-up
#   freeze   save the running chain state, the engine DB and the demo files to demo/frozen/
# ARC_REHEARSAL=1 also starts a local Arc stand-in (chain id 5042002, 6-decimal mock USDC) so the
# whole Approve and sign -> fund -> arc-worker settle flow runs offline. No Anvil default account
# is used anywhere: the demo wallet is the owner's address (scripts/addresses.sh), impersonated on
# the local chains, and the stand-in's operator key is generated fresh into .run/ (gitignored).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/.run"
FROZEN="$ROOT/demo/frozen"
PY="${RISKPILOT_PYTHON:-$ROOT/.venv/bin/python}"
mkdir -p "$RUN"
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
BLOCK=$(sed -nE 's/.*FORK_BLOCK = ([0-9_]+);.*/\1/p' "$ROOT/contracts/aqua/src/DemoParams.sol" | tr -d _)
. "$ROOT/scripts/addresses.sh"

log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
wait_for() { for _ in $(seq 1 120); do eval "$1" >/dev/null 2>&1 && return 0; sleep 0.25; done; echo "timed out: $2" >&2; return 1; }
stop() { [ -f "$RUN/$1.pid" ] && kill "$(cat "$RUN/$1.pid")" 2>/dev/null || true; rm -f "$RUN/$1.pid"; }
listening() { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null; }
port_free() { [ -z "$(listening "$1")" ]; }

chain_up() {
  port_free 8545 || { log "chain already on :8545"; return; }
  : "${AQUA_FORK_RPC_URL:?set AQUA_FORK_RPC_URL (mainnet archive RPC) in riskpilot/.env}"
  if [ -f "$FROZEN/anvil-state.json" ]; then
    log "demo chain from demo/frozen (fork block $BLOCK)"
    cp "$FROZEN/curves.json" "$ROOT/contracts/aqua/demo/curves.json" 2>/dev/null || { mkdir -p "$ROOT/contracts/aqua/demo"; cp "$FROZEN/curves.json" "$ROOT/contracts/aqua/demo/"; }
    mkdir -p "$ROOT/contracts/hook/demo"; cp "$FROZEN/hook.json" "$ROOT/contracts/hook/demo/hook.json"
    # --load-state only reads the frozen file; the frozen copy is never written to.
    anvil --fork-url "$AQUA_FORK_RPC_URL" --fork-block-number "$BLOCK" --chain-id 31337 --port 8545 \
      --load-state "$FROZEN/anvil-state.json" >"$RUN/anvil.log" 2>&1 &
    echo $! >"$RUN/anvil.pid"
    wait_for "cast block-number --rpc-url http://127.0.0.1:8545" "the demo chain"
  else
    log "no frozen state: building the demo chain (make demo-chain + make hook-pool)"
    # The subshell's own output goes to the log too, so callers piping `make up` are not held open.
    (cd "$ROOT/contracts/aqua" && rm -f demo/anvil-state.json && exec ./script/demo-chain.sh) >"$RUN/anvil.log" 2>&1 &
    echo $! >"$RUN/anvil.pid"
    wait_for "grep -q 'Demo chain ready' '$RUN/anvil.log'" "the demo chain build"
    make -C "$ROOT/contracts/hook" hook-pool >"$RUN/hook-pool.log" 2>&1
    FREEZE_AFTER=1
  fi
}

arc_up() {
  [ "${ARC_REHEARSAL:-0}" = 1 ] || return 0
  local rpc=http://127.0.0.1:8547 key="$RUN/arc-operator.key"
  if port_free 8547; then
    anvil --port 8547 --chain-id 5042002 >"$RUN/arc.log" 2>&1 &
    echo $! >"$RUN/arc.pid"
    wait_for "cast block-number --rpc-url $rpc" "the Arc stand-in"
    (umask 077; cast wallet new --json | "$PY" -c 'import json,sys; print(json.load(sys.stdin)[0]["private_key"])' >"$key")
    OPERATOR=$(cast wallet address --private-key "$(cat "$key")")
    OPERATOR_ADDRESS=$OPERATOR make -C "$ROOT/contracts/arc" arc-rehearsal >"$RUN/arc-deploy.log" 2>&1
    DEP="$ROOT/contracts/arc/deployments/arc-rehearsal.json"
    ESCROW=$("$PY" -c "import json;print(json.load(open('$DEP'))['escrow'])")
    MUSDC=$("$PY" -c "import json;print(json.load(open('$DEP'))['usdc'])")
    as() { cast send --rpc-url $rpc --unlocked --from "$ARC_DEPLOYER" "$@" >/dev/null; }
    for who in "$DEMO_WALLET" "$OPERATOR"; do cast rpc --rpc-url $rpc anvil_setBalance "$who" 0x8AC7230489E80000 >/dev/null; done  # 10 (gas)
    cast rpc --rpc-url $rpc anvil_impersonateAccount "$DEMO_WALLET" >/dev/null
    as "$MUSDC" 'mint(address,uint256)' "$DEMO_WALLET" 1000000000
    as "$MUSDC" 'mint(address,uint256)' "$ARC_DEPLOYER" 50000000
    as "$MUSDC" 'approve(address,uint256)' "$ESCROW" 50000000
    as "$ESCROW" 'fundReserve(uint256)' 50000000
    log "Arc stand-in on :8547: escrow $ESCROW, reserve 50 USDC, demo wallet holds 1,000 mock USDC, operator $OPERATOR"
  fi
  export RISKPILOT_ARC_DEPLOYMENT="$ROOT/contracts/arc/deployments/arc-rehearsal.json" ARC_RPC_URL=$rpc
  ARC_OPERATOR_KEY=$(cat "$key"); export ARC_OPERATOR_KEY
}

engine_up() {
  port_free 8000 || { log "engine already on :8000"; return; }
  if [ -f "$FROZEN/riskpilot.db" ] && [ "${KEEP_DB:-0}" != 1 ]; then cp "$FROZEN/riskpilot.db" "$RUN/riskpilot.db"; rm -f "$RUN/riskpilot.db-wal" "$RUN/riskpilot.db-shm"; fi
  (cd "$ROOT/engine" && RISKPILOT_DB="$RUN/riskpilot.db" DEMO_RPC_URL=http://127.0.0.1:8545 \
    exec "$PY" -m uvicorn main:app --port 8000 --timeout-graceful-shutdown 1 --no-access-log >"$RUN/engine.log" 2>&1) &
  echo $! >"$RUN/engine.pid"
  wait_for "curl -sf http://127.0.0.1:8000/v1/health" "the engine"
  log "engine on :8000 (JSON logs: .run/engine.log) · open http://localhost:8000/riskpilot$([ "${ARC_REHEARSAL:-0}" = 1 ] && echo '?arcRpc=http://127.0.0.1:8547')"
}

ids() { curl -sf -X POST "http://127.0.0.1:8000/v1/demo/seed?profile=moderate&wallet=$DEMO_WALLET" | "$PY" -c 'import json,sys; print("\n".join(i["decision"]["decision_id"] for i in json.load(sys.stdin)["items"]))'; }

# The demo wallet's balances after a reset: exactly what the demo chain dealt it.
check_wallet() {
  local rpc=http://127.0.0.1:8545 eth weth usdc
  eth=$(cast balance --rpc-url $rpc "$DEMO_WALLET"); weth=$(cast call --rpc-url $rpc "$WETH" 'balanceOf(address)(uint256)' "$DEMO_WALLET" | awk '{print $1}')
  usdc=$(cast call --rpc-url $rpc "$USDC" 'balanceOf(address)(uint256)' "$DEMO_WALLET" | awk '{print $1}')
  [ "$eth" = "992000000000000000000" ] && [ "$weth" = "8000000000000000000" ] && [ "$usdc" = "5000000000" ] \
    || { echo "demo wallet $DEMO_WALLET balances differ: $eth wei, $weth WETH-wei, $usdc USDC units" >&2; exit 1; }
  log "demo wallet $DEMO_WALLET: 992 ETH, 8 WETH, 5,000 USDC"
}

freeze() {
  mkdir -p "$FROZEN"
  cast rpc anvil_dumpState --rpc-url http://127.0.0.1:8545 | "$PY" -c '
import binascii, gzip, json, sys
raw = binascii.unhexlify(json.loads(sys.stdin.read())[2:])
try: raw = gzip.decompress(raw)
except OSError: pass
open(sys.argv[1], "wb").write(raw)' "$FROZEN/anvil-state.json"
  cp "$ROOT/contracts/aqua/demo/curves.json" "$ROOT/contracts/hook/demo/hook.json" "$FROZEN/"
  ids >"$FROZEN/ids.txt"
  # A clean DB, not a copy of the running one (which holds whatever was tried locally): only the
  # demo wallet on Moderate, recorded as a local default (unsigned; GET /v1/profile shows the
  # source). Any wallet that signs PUT /v1/profile replaces it.
  rm -f "$FROZEN/riskpilot.db" "$FROZEN/riskpilot.db-wal" "$FROZEN/riskpilot.db-shm"
  (cd "$ROOT/engine" && "$PY" -c "
from datetime import datetime, timezone
from store import Store
Store('$FROZEN/riskpilot.db').set_profile('$DEMO_WALLET', 'moderate', datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), 'make demo-freeze: local demo default, not signed')
")
  log "frozen: chain at block $(cast block-number --rpc-url http://127.0.0.1:8545), $(wc -l <"$FROZEN/ids.txt" | tr -d ' ') decision ids, engine DB"
}

down() { stop engine; stop anvil; stop arc; pkill -f "anvil --port 8547 --chain-id 5042002" 2>/dev/null || true
  for p in 8000 8545 8547; do wait_for "port_free $p" "port $p to close" || listening "$p" | xargs kill -9 2>/dev/null || true; done; }

case "${1:-up}" in
  up) FREEZE_AFTER=0; chain_up; arc_up; engine_up; [ "$FREEZE_AFTER" = 1 ] && freeze; true ;;
  down) down; log "stack stopped" ;;
  restart-engine) stop engine; wait_for "port_free 8000" "port 8000 to close"; KEEP_DB=1; arc_up; engine_up ;;
  freeze) freeze ;;
  reset)
    t0=$(date +%s)
    [ -f "$FROZEN/anvil-state.json" ] || { echo "nothing frozen yet: run make up first" >&2; exit 1; }
    down; chain_up; arc_up; engine_up
    now_ids=$(ids)
    if [ "$now_ids" = "$(cat "$FROZEN/ids.txt")" ]; then log "same decision ids as the frozen demo: $(echo $now_ids | tr '\n' ' ')"
    else echo "decision ids differ from demo/frozen/ids.txt:" >&2; diff <(echo "$now_ids") "$FROZEN/ids.txt" >&2 || true; exit 1; fi
    check_wallet
    log "demo-reset done in $(( $(date +%s) - t0 )) s" ;;
  *) echo "usage: stack.sh up|down|reset|freeze" >&2; exit 2 ;;
esac
