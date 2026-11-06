# One command from a clean checkout: fetch pinned deps, fork mainnet, run the whole flow.
AQUA_FORK_RPC_URL ?= https://ethereum-rpc.publicnode.com

.PHONY: test deps

deps:
	cd ../.. && git submodule update --init contracts/aqua/lib/swap-vm contracts/aqua/lib/aqua \
		contracts/aqua/lib/solidity-utils contracts/aqua/lib/openzeppelin-contracts contracts/aqua/lib/forge-std

test: deps
	AQUA_FORK_RPC_URL=$(AQUA_FORK_RPC_URL) forge test -vv
