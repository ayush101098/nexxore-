# RiskPilotEscrow (PRD 5) on Arc testnet.
ENGINE ?= http://localhost:8000

.PHONY: deps test deploy-arc-testnet arc-deploy arc-rehearsal arc-settle arc-status ts

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

# Deploy only. Writes deployments/arc-testnet.json: escrow, operator, USDC (0x3600…0000, 6 dp),
# deploy tx and block. Settlement is then automatic: the engine's arc-worker settles every
# Funded decision with the operator key (ARC_OPERATOR_KEY in the engine's environment).
# Usage: make arc-deploy SENDER=0xYourAddress [WALLET=--account riskpilot]
arc-deploy: deploy-arc-testnet
	@python3 script/record_deploy_tx.py broadcast/DeployEscrow.s.sol/5042002/run-latest.json deployments/arc-testnet.json

# Local rehearsal of the whole Arc flow: an Anvil on :8547 (chain id 5042002) with a 6-decimal
# mock USDC. The deployer is a keccak-derived address, impersonated (no key); the operator is
# OPERATOR_ADDRESS (the stand-in generates a fresh key for it). Writes deployments/arc-rehearsal.json.
REHEARSAL_RPC ?= http://127.0.0.1:8547
arc-rehearsal: deps
	@. ../../scripts/addresses.sh; D=$$ARC_DEPLOYER; \
	cast rpc --rpc-url $(REHEARSAL_RPC) anvil_setBalance $$D 0x3635C9ADC5DEA00000 >/dev/null; \
	cast rpc --rpc-url $(REHEARSAL_RPC) anvil_impersonateAccount $$D >/dev/null; \
	USDC=$$(forge create test/RiskPilotEscrow.t.sol:MockUSDC --rpc-url $(REHEARSAL_RPC) --unlocked --from $$D --broadcast --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployedTo"])'); \
	ARC_REHEARSAL=true ARC_USDC=$$USDC ARC_DEPLOYMENT_OUT=./deployments/arc-rehearsal.json \
	forge script script/DeployEscrow.s.sol --rpc-url $(REHEARSAL_RPC) --unlocked --sender $$D --broadcast -q && \
	python3 script/record_deploy_tx.py broadcast/DeployEscrow.s.sol/$$(cast chain-id --rpc-url $(REHEARSAL_RPC))/run-latest.json deployments/arc-rehearsal.json && \
	cat deployments/arc-rehearsal.json

# Operator step (manual fallback; the arc-worker does this automatically): ask the engine for the payout of an executed decision, settle on Arc from your
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
