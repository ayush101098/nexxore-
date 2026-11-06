# contracts/arc — PRD 5: RiskPilotEscrow (Arc)

This is a small escrow on Arc testnet. It holds the user's USDC for each
approved RiskPilot decision and settles the result in USDC, keyed by
`decisionId = keccak256(decision_id)`.

```bash
make test                 # 7 tests (forge)
make deploy-arc-testnet SENDER=0xYourAddress   # signs with your wallet (forge prompts; nothing stored)
make arc-settle DECISION=dec_… AMOUNT=5        # operator (your wallet): engine payout -> settle() -> recorded
make arc-status DECISION=dec_…
```

## What Arc adds

Arc adds per-decision USDC escrow and settlement to an existing DeFi product.

- **Every approval has its own record.** Each approved RiskPilot strategy
  gets its own escrow entry on Arc: the user's USDC goes in under that
  decision's ID, and the operator settles the result in USDC once the trade
  is verified on its execution chain (the Aqua demo fork, or the v4 testnet).
- **The record links back to the trade.** The `/riskpilot` page shows the Arc
  fund and settle transactions next to the decision they belong to, and the
  engine records the settle transaction on that decision's Execution
  (`settlement_tx`).
- **USDC throughout.** Funding, gas and payouts are all USDC, so the user
  never needs another token to settle a strategy.

## Contract: `src/RiskPilotEscrow.sol`

| Function | Caller | Does |
|---|---|---|
| `fund(decisionId, amount)` | user | Pulls USDC in for a decision; status Funded. Once per decision. |
| `settle(decisionId, payout)` | operator | Pays `payout` to the depositor. A loss moves the remainder to the reserve; a gain is topped up from it. Status Settled. |
| `refund(decisionId)` | depositor | Returns the full amount if not settled within 24 h. |
| `fundReserve(amount)` | anyone | Adds USDC to the reserve that pays gains. |

Rules:

- **One settlement per decision.**
- **Bounded payout:** `payout ≤ amount + reserve`.
- **Operator only:** only the operator can settle.
- **State first:** state changes before every transfer, using SafeERC20.
- **Events:** `Funded`, `Settled`, `Refunded`, `ReserveFunded`.

**Token.** The contract uses Arc testnet's USDC ERC-20 interface at
`0x3600000000000000000000000000000000000000`, which uses **6 decimals**,
confirmed on-chain with `decimals()`. Arc's native USDC, used for gas, uses
18 decimals, and the docs say it shares the same underlying balance. The escrow
and the helper use only the ERC-20 interface.

Arc testnet details, from the
[Arc docs](https://docs.arc.io/arc/references/connect-to-arc):
- chain ID 5042002, confirmed on-chain;
- RPC `https://rpc.testnet.arc.io`;
- explorer `https://explorer.testnet.arc.io`.

## Trust model

The operator (the RiskPilot backend) settles after checking the trade's result
on the execution chain. **That step is trusted in this demo.** The user's
protection is the 24-hour refund: if the operator never settles, the depositor
takes the full amount back. The trust-minimized version, which settles from a
cross-chain message via Circle's CCTP, is on the roadmap. CCTP is live on Arc
testnet (domain 26; TokenMessengerV2 `0x8FE6…0DAA`).

**Payout rule in the demo.** `GET /decisions/{id}/settlement?amount=…` on the
engine returns `payout = amount × (1 + net_edge / size)`, the decision's priced
edge pro rata to the escrowed amount. It requires an APPROVE decision with a
verified Execution. It's the engine's priced result, not a realized-P&L
measurement.

## Flow

1. The engine returns APPROVE, and the `/riskpilot` page offers **Fund on Arc**
   for that decision. It uses a browser wallet on chain 5042002: approve, then
   `fund(keccak256(decision_id), amount)`.
2. The strategy executes on its own chain, and the page records the verified
   Execution.
3. `make arc-settle DECISION=… AMOUNT=…` asks the engine for the payout,
   calls `settle` as the operator, and POSTs the settle transaction to
   `/decisions/{id}/settlement`.
4. The page's Arc panel lists every Funded and Settled event with explorer links,
   matched back to the decision.

## TypeScript helper: `ts/escrow.ts` (viem)

It exports `fund()`, which the web app's wallet calls, and `settle()`, which
the engine's operator calls. It also exports `status()`, `fundReserve()`,
`decisionKey()`, the ABI and an `arcTestnet` chain definition. It's also a CLI:

```bash
cd ts && npm install
npx tsx escrow.ts status dec_…
PRIVATE_KEY=… npx tsx escrow.ts fund dec_… 5.00
PRIVATE_KEY=… npx tsx escrow.ts settle dec_… 5.001806
```

**Rehearsal.** The flow was rehearsed against a local Anvil with a 6-decimal
mock USDC:
- reserve 50 USDC, fund 5.00 USDC for a real approved decision, settle
  5.001806 USDC;
- the reserve dropped by the gain, and a non-operator settle reverted with
  `NotOperator`;
- the page's Arc panel showed both transactions matched to the decision ID.

## Tests (`test/RiskPilotEscrow.t.sol`)

| PRD 5 test | Test |
|---|---|
| Fund, settle at a loss: payout to the user, remainder to the reserve | `test_SettleAtALossMovesRemainderToReserve` |
| Fund, settle at a gain: the reserve tops up the payout | `test_SettleAtAGainDrawsOnReserve` |
| Second settle reverts; non-operator settle reverts | `test_SettleOnceAndOnlyByOperator` |
| Payout above amount + reserve reverts | `test_PayoutAboveAmountPlusReserveReverts` |
| Refund after 24 h, not before | `test_RefundOnlyAfter24Hours` |

Plus `test_ADecisionFundsOnce` and `test_ZeroAmountsRevert`.

## Deployment

**Not deployed yet.** Deploys are signed by your own wallet only. `--interactive` makes forge and
cast prompt for the key at signing time, so it is never written to disk or passed around.
`WALLET=--ledger` or `WALLET=--account <keystore>` also work. A dry run as
`0x905aCd442c7B3EF9BfEB0A3189f3686c1Cd0c697` passes: the escrow would deploy at
`0x64c1Af27bdBEcdA432BB4C8cCFec83099962e51E` (that address depends on the account's nonce) with that
wallet as operator, and needs about 0.031 USDC of gas.

TODO: run `make deploy-arc-testnet SENDER=0x905a…c697`, then fund and settle one approved decision.
After that, add the escrow address and the fund and settle transaction links here.
