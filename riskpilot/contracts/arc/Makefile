# RiskPilotEscrow (PRD 5) on Arc testnet.
ENGINE ?= http://localhost:8000

.PHONY: deps test deploy-arc-testnet arc-settle arc-status ts

deps:
	git submodule update --init lib/forge-std lib/openzeppelin-contracts

test: deps
	forge test -vv

ts:
	cd ts && npm install --silent

# Signed by your own wallet: forge/cast prompt for the key (nothing is stored).
# WALLET=--ledger or --account <keystore name> also work.
WALLET ?= --interactive
ARC_RPC ?= $${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}

# Usage: make deploy-arc-testnet SENDER=0xYourAddress   (the deployer becomes the operator)
deploy-arc-testnet:
	@test -n "$(SENDER)" || { echo "usage: make deploy-arc-testnet SENDER=0xYourAddress"; exit 1; }
	mkdir -p deployments
	forge script script/DeployEscrow.s.sol --rpc-url $(ARC_RPC) --sender $(SENDER) $(WALLET) --broadcast

# Operator step: ask the engine for the payout of an executed decision, settle on Arc from your
# wallet, record the settle tx on the decision's Execution.
# Usage: make arc-settle DECISION=dec_… AMOUNT=<usdc funded>
arc-settle:
	@test -n "$(DECISION)" && test -n "$(AMOUNT)" || { echo "usage: make arc-settle DECISION=dec_… AMOUNT=<usdc funded>"; exit 1; }; \
	ESCROW=$$(python3 -c 'import json; print(json.load(open("deployments/arc-testnet.json"))["escrow"])') || { echo "deploy first"; exit 1; }; \
	PAYOUT=$$(curl -sf "$(ENGINE)/decisions/$(DECISION)/settlement?amount=$(AMOUNT)" | python3 -c 'import json,sys; from decimal import Decimal; print(int(Decimal(json.load(sys.stdin)["payout"]) * 10**6))') || { echo "engine refused the settlement (is the decision executed?)"; exit 1; }; \
	echo "payout: $$PAYOUT USDC units (6 dp)"; \
	TX=$$(cast send $$ESCROW 'settle(bytes32,uint256)' $$(cast keccak "$(DECISION)") $$PAYOUT --rpc-url $(ARC_RPC) $(WALLET) --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["transactionHash"])'); \
	echo "settle tx: https://explorer.testnet.arc.io/tx/$$TX"; \
	curl -sf -X POST "$(ENGINE)/decisions/$(DECISION)/settlement" -H 'content-type: application/json' -d "{\"settlement_tx\": \"$$TX\"}" >/dev/null && echo "recorded on the decision's Execution"

arc-status: ts
	@cd ts && npx tsx escrow.ts status $(DECISION)
