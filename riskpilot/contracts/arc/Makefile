# RiskPilotEscrow (PRD 5) on Arc testnet. Keys come from ../../.env (gitignored).
ENV = set -a; . ../../.env; set +a
ENGINE ?= http://localhost:8000

.PHONY: deps test deploy-arc-testnet arc-settle arc-status ts

deps:
	git submodule update --init lib/forge-std lib/openzeppelin-contracts

test: deps
	forge test -vv

ts:
	cd ts && npm install --silent

# Deploy from DEPLOYER_PRIVATE_KEY (fund it at https://faucet.circle.com, Arc testnet).
deploy-arc-testnet:
	@$(ENV); forge script script/DeployEscrow.s.sol --rpc-url $${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io} \
		--private-key $$DEPLOYER_PRIVATE_KEY --broadcast

# Operator step: ask the engine for the payout of an executed decision, settle on Arc,
# record the settle tx on the decision's Execution. Usage: make arc-settle DECISION=dec_… AMOUNT=5
arc-settle: ts
	@$(ENV); test -n "$(DECISION)" && test -n "$(AMOUNT)" || { echo "usage: make arc-settle DECISION=dec_… AMOUNT=<usdc funded>"; exit 1; }; \
	PAYOUT=$$(curl -sf "$(ENGINE)/decisions/$(DECISION)/settlement?amount=$(AMOUNT)" | python3 -c 'import json,sys; print(json.load(sys.stdin)["payout"])') || { echo "engine refused the settlement (is the decision executed?)"; exit 1; }; \
	echo "payout for $(AMOUNT) USDC: $$PAYOUT USDC"; \
	TX=$$(cd ts && PRIVATE_KEY=$$DEPLOYER_PRIVATE_KEY npx tsx escrow.ts settle $(DECISION) $$PAYOUT | python3 -c 'import json,sys; print(json.load(sys.stdin)["settleTx"].rsplit("/",1)[-1])'); \
	echo "settle tx: $$TX"; \
	curl -sf -X POST "$(ENGINE)/decisions/$(DECISION)/settlement" -H 'content-type: application/json' -d "{\"settlement_tx\": \"$$TX\"}" >/dev/null && echo "recorded on the decision's Execution"

arc-status: ts
	@cd ts && npx tsx escrow.ts status $(DECISION)
