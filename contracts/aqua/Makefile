# One command from a clean checkout: fetch pinned deps, fork mainnet at the pinned block, run the flow.
# Older pinned blocks need an archive RPC: export AQUA_FORK_RPC_URL=<your mainnet archive rpc>.
AQUA_FORK_RPC_URL ?= https://ethereum-rpc.publicnode.com
export AQUA_FORK_RPC_URL
TAKER_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
CURVE ?= upside

.PHONY: test deps demo-chain demo-fill demo-reset

deps:
	cd ../.. && git submodule update --init contracts/aqua/lib/swap-vm contracts/aqua/lib/aqua \
		contracts/aqua/lib/solidity-utils contracts/aqua/lib/openzeppelin-contracts contracts/aqua/lib/forge-std

test: deps
	forge test -vv

# Persistent Anvil fork with both demo curves shipped; restarts reload demo/anvil-state.json.
demo-chain: deps
	./script/demo-chain.sh

# Scripted taker against the running demo chain: CURVE=upside|downside [AMOUNT=...]
demo-fill:
	TAKER_PRIVATE_KEY=$(TAKER_PK) CURVE=$(CURVE) forge script script/TakeDemoFill.s.sol \
		--rpc-url http://127.0.0.1:$${DEMO_PORT:-8545} --broadcast

demo-reset:
	rm -f demo/anvil-state.json demo/curves.json demo/anvil.log
