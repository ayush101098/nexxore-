"""Add the deploy transaction hash from forge's broadcast log to the deployment JSON."""
import json
import sys

broadcast, deployment = sys.argv[1], sys.argv[2]
run = json.load(open(broadcast))
tx = next(t for t in run["transactions"] if t.get("contractName") == "RiskPilotEscrow")
dep = json.load(open(deployment))
dep["deploy_tx"] = tx["hash"]
json.dump(dep, open(deployment, "w"), indent=2)
print(f"deploy tx {tx['hash']} recorded in {deployment}")
