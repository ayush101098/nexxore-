"""run_stress_test: reprice a book of Positions over the PRD 2 scenario grid.

Spot positions (v4_swap) are linear in their delta. Aqua curves are repriced
as their equivalent option with Black-Scholes at K_eq and T_eq, the term
fixed at inception vol, so a vol shock costs the short-vega curve money.
That is the PRD's convention; the curve's own token balances depend only on
price, so this overstates vol risk rather than hiding it.
"""

from pricing import aqua_equivalent, bs_price

SPOT_SHOCKS = (-0.40, -0.20, -0.10, 0.10, 0.20, 0.40, 0.60)
VOL_SHOCKS = (0.0, 0.20)


def position_pnl(position: dict, spot: float, spot_shock: float, vol_shock: float) -> float:
    shocked = spot * (1 + spot_shock)
    if position["primitive"] != "aqua":
        return float(position["greeks"]["delta"]) * (shocked - spot)

    p = position["params"]
    q = float(p["quantity_eth"])
    sigma = float(p["volatility"])
    is_call = p["side"] == "call_like"
    k_eq, t_eq = aqua_equivalent(float(p["range_low"]), float(p["range_high"]), sigma)
    option_change = bs_price(shocked, k_eq, t_eq, sigma + vol_shock, is_call) - bs_price(
        spot, k_eq, t_eq, sigma, is_call
    )
    # call_like = long ETH + short call; put_like = short put.
    spot_leg = q * (shocked - spot) if is_call else 0.0
    return spot_leg - q * option_change


def run_stress_test(positions: list[dict], spot: float | None = None) -> dict:
    """P&L per scenario and the worst loss (a positive number, 0 if nothing loses).

    spot is the current ETH price; when omitted each position is shocked from
    its own entry price.
    """
    scenarios = []
    for vol_shock in VOL_SHOCKS:
        for spot_shock in SPOT_SHOCKS:
            pnl = sum(
                position_pnl(p, spot if spot is not None else float(p["entry"]["price"]), spot_shock, vol_shock)
                for p in positions
            )
            scenarios.append({"spot_shock": spot_shock, "vol_shock": vol_shock, "pnl": pnl})
    worst = min(scenarios, key=lambda s: s["pnl"])
    return {"scenarios": scenarios, "worst_loss": max(0.0, -worst["pnl"]), "worst_scenario": worst}
