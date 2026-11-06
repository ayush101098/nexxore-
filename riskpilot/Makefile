# One-shot public testnet run, signed by YOUR wallet only (forge/cast prompt for it; nothing is stored).
#   make testnet SENDER=0xYourAddress
# Fewer prompts: import once with `cast wallet import riskpilot --interactive`, then add
#   WALLET="--account riskpilot"   (prompts for the keystore password instead of the key).
# Needs the demo chain and engine running (the settle step asks the engine for the payout).
SENDER ?=
WALLET ?= --interactive
DECISION ?= dec_c30a51bd0724adcb
AMOUNT ?= 5
ARC_RPC = https://rpc.testnet.arc.io
ARC_USDC = 0x3600000000000000000000000000000000000000

.PHONY: testnet

testnet:
	@test -n "$(SENDER)" || { echo "usage: make testnet SENDER=0xYourAddress [WALLET=--account <name>]"; exit 1; }
	@echo "== 1/4 VolatilityFeeHook -> Unichain Sepolia"
	$(MAKE) -C contracts/hook deploy-unichain-sepolia SENDER=$(SENDER) WALLET="$(WALLET)"
	@echo "== 2/4 RiskPilotEscrow -> Arc testnet"
	$(MAKE) -C contracts/arc deploy-arc-testnet SENDER=$(SENDER) WALLET="$(WALLET)"
	@echo "== 3/4 fund $(AMOUNT) USDC for $(DECISION)"
	@ESCROW=$$(python3 -c 'import json;print(json.load(open("contracts/arc/deployments/arc-testnet.json"))["escrow"])'); \
	UNITS=$$(python3 -c 'from decimal import Decimal; print(int(Decimal("$(AMOUNT)") * 10**6))'); \
	cast send $(ARC_USDC) 'approve(address,uint256)' $$ESCROW $$UNITS --rpc-url $(ARC_RPC) $(WALLET) >/dev/null && \
	cast send $$ESCROW 'fund(bytes32,uint256)' $$(cast keccak "$(DECISION)") $$UNITS --rpc-url $(ARC_RPC) $(WALLET) --json \
		| python3 -c 'import json,sys; print("fund tx: https://explorer.testnet.arc.io/tx/" + json.load(sys.stdin)["transactionHash"])'
	@echo "== 4/4 settle as operator"
	$(MAKE) -C contracts/arc arc-settle DECISION=$(DECISION) AMOUNT=$(AMOUNT) WALLET="$(WALLET)"
	@echo "Done. Tell Claude; it will verify on-chain and update the READMEs."
