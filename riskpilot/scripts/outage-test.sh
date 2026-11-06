#!/usr/bin/env bash
# Outage test (hardening 7.2): a real engine kill (SIGKILL) under a headed browser.
# Needs the demo chain on :8545 (make up, or make demo-chain + make hook-pool).
# Pass: every panel shows "Source unavailable: engine" within 5 s, then recovers with no reload.
set -euo pipefail
cd "$(dirname "$0")/../web"
npx playwright test riskpilot -g "kill the engine" --headed "$@"
