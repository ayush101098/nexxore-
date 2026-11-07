#!/usr/bin/env bash
# The always-on agent (Render, or any container host): the demo chain and the engine in one container.
#   anvil: the Ethereum mainnet fork from the frozen demo state, on localhost only (never exposed)
#   engine: :$PORT, the public endpoint; the page reads the chain through its /v1/rpc gateway
# Secrets come from the host's environment: AQUA_FORK_RPC_URL (mainnet archive RPC), ZG_API_KEY,
# ARC_OPERATOR_KEY (the arc-worker), RISKPILOT_ENGINE_KEY (decision signatures).
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$APP/deploy/state"
ANVIL_PORT="${ANVIL_PORT:-8545}"
DATA="${DATA_DIR:-/data}"; mkdir -p "$DATA" 2>/dev/null && [ -w "$DATA" ] || DATA="$(mktemp -d)"
: "${AQUA_FORK_RPC_URL:?set AQUA_FORK_RPC_URL (an Ethereum mainnet archive RPC) in the host environment}"
BLOCK=26354292
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# Each boot starts the chain from the frozen demo state (block 26,354,377): a clean demo.
anvil --fork-url "$AQUA_FORK_RPC_URL" --fork-block-number "$BLOCK" --chain-id 31337 \
  --host 127.0.0.1 --port "$ANVIL_PORT" --load-state "$STATE/anvil-state.json" --silent &
ANVIL=$!
python3 - "$ANVIL_PORT" <<'PY'
import json, sys, time, urllib.request
url = f"http://127.0.0.1:{sys.argv[1]}"
for _ in range(240):
    try:
        req = urllib.request.Request(url, b'{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}', {"Content-Type": "application/json"})
        print("demo chain at block", int(json.load(urllib.request.urlopen(req, timeout=2))["result"], 16)); break
    except Exception:
        time.sleep(0.5)
else:
    sys.exit("demo chain did not start")
PY

export DEMO_RPC_URL="http://127.0.0.1:$ANVIL_PORT" RISKPILOT_DEMO_DIR="$STATE" RISKPILOT_HOOK_DIR="$STATE" \
  RISKPILOT_DB="$DATA/riskpilot.db" ARC_RPC_URL="${ARC_RPC_URL:-https://rpc.testnet.arc.io}" PYTHONUNBUFFERED=1
# The demo wallet's default profile (as make demo-freeze records it), unless one was signed since.
cd "$APP/engine"
python3 - "${DATABASE_URL:-$RISKPILOT_DB}" <<'PY'
import sys
from datetime import datetime, timezone
from store import open_store
s, w = open_store(sys.argv[1]), "0x905aCd442c7B3EF9BfEB0A3189f3686c1Cd0c697"
if s.get_profile(w) is None:
    s.set_profile(w, "moderate", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "deploy: demo default, not signed")
PY
cd "$APP"
log "engine on :${PORT:-8000} (db: $([ -n "${DATABASE_URL:-}" ] && echo "Postgres (DATABASE_URL)" || echo "$RISKPILOT_DB"))"
(cd "$APP/engine" && exec python3 -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --timeout-graceful-shutdown 1 --no-access-log) &
ENGINE=$!
# If either process exits, exit too, so the host restarts the container.
trap 'kill "$ANVIL" "$ENGINE" 2>/dev/null || true' TERM INT
while kill -0 "$ANVIL" 2>/dev/null && kill -0 "$ENGINE" 2>/dev/null; do sleep 2; done
log "the $(kill -0 "$ANVIL" 2>/dev/null && echo engine || echo demo chain) exited; stopping"
kill "$ANVIL" "$ENGINE" 2>/dev/null || true
exit 1
