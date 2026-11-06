# Demo actors on the local chains. None is an Anvil default account (their keys are public).
# DEMO_WALLET is the owner's address; the others are keccak256(label) addresses that nobody
# holds a key for. All of them act on the fork through Anvil impersonation (--unlocked).
DEMO_WALLET="${DEMO_WALLET:-0x905aCd442c7B3EF9BfEB0A3189f3686c1Cd0c697}"
label_address() { cast to-check-sum-address "0x$(cast keccak "$1" | cut -c27-66)"; }
DEMO_TAKER="${DEMO_TAKER:-$(label_address "riskpilot demo taker")}"
DEMO_LP="${DEMO_LP:-$(label_address "riskpilot demo lp")}"
ARC_DEPLOYER="${ARC_DEPLOYER:-$(label_address "riskpilot arc stand-in deployer")}"
WETH=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
