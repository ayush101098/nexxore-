# VolatilityFeeHook (PRD 4). Demo chain: the Anvil mainnet fork from contracts/aqua (make demo-chain).
RPC ?= http://127.0.0.1:$${DEMO_PORT:-8545}
# Anvil's default account #2 (public test key) provides the hook pools' liquidity.
LP_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
# Large USDC holder at the pinned block (found by contracts/aqua/script/find_usdc_holder.py).
USDC_HOLDER = 0x37305b1cd40574e4c5ce33f8e8306be057fd7341

.PHONY: deps test hook-demo hook-pool deploy-unichain-sepolia

deps:
	git submodule update --init lib/forge-std lib/hookmate && git submodule update --init --recursive lib/uniswap-hooks

test: deps
	forge test -vv

# Same swap sequence through the hooked pool and a static 0.30% pool, on the demo chain's
# state. Simulated (nothing broadcast), so it can run any number of times.
hook-demo:
	forge script script/HookDemo.s.sol --rpc-url $(RPC)

# Deploy the hook and the live pools on the demo chain, funded by Anvil account #2.
hook-pool:
	@LP=$$(cast wallet address --private-key $(LP_PK)); \
	cast rpc --rpc-url $(RPC) anvil_setBalance $$LP 0xa2a15d09519be00000 >/dev/null; \
	cast send --rpc-url $(RPC) --private-key $(LP_PK) $(WETH) 'deposit()' --value 2200ether >/dev/null; \
	cast rpc --rpc-url $(RPC) anvil_impersonateAccount $(USDC_HOLDER) >/dev/null; \
	cast rpc --rpc-url $(RPC) anvil_setBalance $(USDC_HOLDER) 0xDE0B6B3A7640000 >/dev/null; \
	cast send --rpc-url $(RPC) --from $(USDC_HOLDER) --unlocked $(USDC) 'transfer(address,uint256)' $$LP 5000000000000 >/dev/null; \
	cast rpc --rpc-url $(RPC) anvil_stopImpersonatingAccount $(USDC_HOLDER) >/dev/null; \
	mkdir -p demo; \
	LP_PRIVATE_KEY=$(LP_PK) forge script script/HookPool.s.sol --rpc-url $(RPC) --broadcast --slow

# Public testnet deploy, signed by your own wallet: forge prompts for the key (nothing is stored).
# Usage: make deploy-unichain-sepolia SENDER=0xYourAddress   (WALLET=--ledger or --account <name> also work)
WALLET ?= --interactive
deploy-unichain-sepolia:
	@test -n "$(SENDER)" || { echo "usage: make deploy-unichain-sepolia SENDER=0xYourAddress"; exit 1; }
	mkdir -p deployments
	forge script script/DeployHook.s.sol --rpc-url $${UNICHAIN_SEPOLIA_RPC_URL:-https://sepolia.unichain.org} \
		--sender $(SENDER) $(WALLET) --broadcast
