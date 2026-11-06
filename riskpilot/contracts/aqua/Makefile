# One command from a clean checkout: fetch pinned deps, fork mainnet at the pinned block, run the flow.
# Older pinned blocks need an archive RPC: export AQUA_FORK_RPC_URL=<your mainnet archive rpc>.
AQUA_FORK_RPC_URL ?= https://ethereum-rpc.publicnode.com
export AQUA_FORK_RPC_URL
CURVE ?= upside

.PHONY: test deps demo-chain demo-ship demo-fill demo-reset
# Demo actors are addresses, never keys: they act on the fork through Anvil impersonation.
ACTORS = . ../../scripts/addresses.sh

# Paths are relative to this directory, so this works wherever the repo root is.
deps:
	git submodule update --init lib/swap-vm lib/aqua lib/solidity-utils lib/openzeppelin-contracts lib/forge-std

test: deps
	forge test -vv

# Persistent Anvil fork with both demo curves shipped; restarts reload demo/anvil-state.json.
demo-chain: deps
	./script/demo-chain.sh

# Ship the approved call-like curve from the CLI (the page normally does this on Approve and sign).
demo-ship:
	@$(ACTORS); MAKER=$$DEMO_WALLET SHIP=upside forge script script/ShipDemoCurves.s.sol \
		--rpc-url http://127.0.0.1:$${DEMO_PORT:-8545} --broadcast --unlocked --sender $$DEMO_WALLET

# Scripted taker against the running demo chain: CURVE=upside|downside [AMOUNT=...]
demo-fill:
	@$(ACTORS); cast rpc --rpc-url http://127.0.0.1:$${DEMO_PORT:-8545} anvil_impersonateAccount $$DEMO_TAKER >/dev/null; \
	TAKER=$$DEMO_TAKER CURVE=$(CURVE) forge script script/TakeDemoFill.s.sol \
		--rpc-url http://127.0.0.1:$${DEMO_PORT:-8545} --broadcast --unlocked --sender $$DEMO_TAKER

demo-reset:
	rm -f demo/anvil-state.json demo/curves.json demo/anvil.log
