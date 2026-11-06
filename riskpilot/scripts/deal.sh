#!/usr/bin/env bash
# deal ADDRESS ETH WETH USDC [RPC]: set an address's balances on the demo fork, like forge's deal().
# ETH (gas) via anvil_setBalance; WETH and USDC by writing their balance mappings directly
# (WETH9 balanceOf: slot 3; FiatToken USDC balanceAndBlacklistStates: slot 9), then checked with
# balanceOf. Amounts in whole units, e.g. deal 0x… 992 8 5000.
set -euo pipefail
. "$(dirname "$0")/addresses.sh"
ADDR=$1 ETH=$2 W=$3 U=$4 RPC=${5:-http://127.0.0.1:8545}
hex() { cast to-uint256 "$1"; }
cast rpc --rpc-url "$RPC" anvil_setBalance "$ADDR" "$(cast to-hex "$(cast to-wei "$ETH")")" >/dev/null
cast rpc --rpc-url "$RPC" anvil_setStorageAt "$WETH" "$(cast index address "$ADDR" 3)" "$(hex "$(cast to-wei "$W")")" >/dev/null
cast rpc --rpc-url "$RPC" anvil_setStorageAt "$USDC" "$(cast index address "$ADDR" 9)" "$(hex $((U * 1000000)))" >/dev/null
cast rpc --rpc-url "$RPC" anvil_impersonateAccount "$ADDR" >/dev/null
got_w=$(cast call --rpc-url "$RPC" "$WETH" 'balanceOf(address)(uint256)' "$ADDR" | awk '{print $1}')
got_u=$(cast call --rpc-url "$RPC" "$USDC" 'balanceOf(address)(uint256)' "$ADDR" | awk '{print $1}')
[ "$got_w" = "$(cast to-wei "$W")" ] && [ "$got_u" = "$((U * 1000000))" ] || { echo "deal $ADDR: balanceOf reads $got_w WETH-wei, $got_u USDC units" >&2; exit 1; }
echo "dealt $ADDR: $ETH ETH, $W WETH, $U USDC (impersonated)"
