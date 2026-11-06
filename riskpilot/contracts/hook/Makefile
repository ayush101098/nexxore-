# VolatilityFeeHook (PRD 4). Demo chain: the Anvil mainnet fork from contracts/aqua (make demo-chain).
RPC ?= http://127.0.0.1:$${DEMO_PORT:-8545}
# The LP is a keccak-derived address (../../scripts/addresses.sh), impersonated on the fork: no key.
ACTORS = . ../../scripts/addresses.sh
WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

.PHONY: hook-volatile deps test hook-demo hook-pool deploy-unichain-sepolia

deps:
	git submodule update --init lib/forge-std lib/hookmate && git submodule update --init --recursive lib/uniswap-hooks

test: deps
	forge test -vv

# Same swap sequence through the hooked pool and a static 0.30% pool, on the demo chain's
# state. Simulated (nothing broadcast), so it can run any number of times.
hook-demo:
	forge script script/HookDemo.s.sol --rpc-url $(RPC)

# Deploy the hook and the live pools on the demo chain, funded by Anvil account #2.
# A volatile spell through the live hooked pool: the fee rises toward the cap (VOL_BLOCKS, VOL_ETH).
hook-volatile:
	@$(ACTORS); cast rpc --rpc-url $(RPC) anvil_impersonateAccount $$DEMO_LP >/dev/null; \
	LP=$$DEMO_LP forge script script/HookVolatile.s.sol --rpc-url $(RPC) --broadcast --slow --unlocked --sender $$DEMO_LP 2>&1 | grep -E "fee (before|after)|Error" || true

hook-pool:
	@$(ACTORS); ../../scripts/deal.sh $$DEMO_LP 3000 2200 5000000 $(RPC) && mkdir -p demo && \
	LP=$$DEMO_LP forge script script/HookPool.s.sol --rpc-url $(RPC) --broadcast --slow --unlocked --sender $$DEMO_LP

# Public testnet deploy, signed by your own wallet: forge prompts for the key (nothing is stored).
# Usage: make deploy-unichain-sepolia SENDER=0xYourAddress   (WALLET=--ledger or --account <name> also work)
WALLET ?= --interactive
deploy-unichain-sepolia:
	@test -n "$(SENDER)" || { echo "usage: make deploy-unichain-sepolia SENDER=0xYourAddress"; exit 1; }
	mkdir -p deployments
	forge script script/DeployHook.s.sol --rpc-url $${UNICHAIN_SEPOLIA_RPC_URL:-https://sepolia.unichain.org} \
		--sender $(SENDER) $(WALLET) --broadcast
