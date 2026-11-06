import pytest

from pricing import aqua_equivalent, bs_price
from stress import run_stress_test


def linear(delta: str, entry: str = "3400.00") -> dict:
    return {
        "position_id": "pos_l",
        "decision_id": "dec_l",
        "primitive": "v4_swap",
        "params": {},
        "collateral": "0",
        "entry": {"price": entry, "at": "2026-11-06T09:00:00Z"},
        "greeks": {"delta": delta, "gamma": "0", "vega": "0", "theta": "0"},
        "status": "open",
    }


def aqua(side: str, low: str, high: str, q: str = "1.0", vol: str = "0.65") -> dict:
    return {
        "position_id": "pos_a",
        "decision_id": "dec_a",
        "primitive": "aqua",
        "params": {"side": side, "range_low": low, "range_high": high, "quantity_eth": q, "volatility": vol},
        "collateral": "0",
        "entry": {"price": "3386.00", "at": "2026-11-06T09:00:00Z"},
        "greeks": {"delta": "0", "gamma": "0", "vega": "0", "theta": "0"},
        "status": "open",
    }


def test_grid_has_14_scenarios():
    result = run_stress_test([linear("1")], spot=3000)
    assert len(result["scenarios"]) == 14


def test_empty_book_has_no_loss():
    assert run_stress_test([], spot=3000)["worst_loss"] == 0


def test_long_spot_worst_case_is_minus_40():
    result = run_stress_test([linear("0.5")], spot=3000)
    assert result["worst_loss"] == pytest.approx(0.5 * 3000 * 0.40)
    assert result["worst_scenario"]["spot_shock"] == -0.40


def test_short_spot_worst_case_is_plus_60():
    result = run_stress_test([linear("-0.5")], spot=3000)
    assert result["worst_loss"] == pytest.approx(0.5 * 3000 * 0.60)


def test_spot_defaults_to_entry_price():
    assert run_stress_test([linear("1", entry="2000")])["worst_loss"] == pytest.approx(800)


def test_cash_secured_put_reprices_with_black_scholes():
    pos = aqua("put_like", "3100", "3300", q="2.0")
    result = run_stress_test([pos], spot=3386)
    k, t = aqua_equivalent(3100, 3300, 0.65)
    expected = 2.0 * (bs_price(3386 * 0.6, k, t, 0.85, False) - bs_price(3386, k, t, 0.65, False))
    assert result["worst_loss"] == pytest.approx(expected)


def test_vol_shock_hurts_short_vega_curve():
    pos = aqua("call_like", "3400", "3600")
    by = {(s["spot_shock"], s["vol_shock"]): s["pnl"] for s in run_stress_test([pos], spot=3386)["scenarios"]}
    assert by[(0.10, 0.20)] < by[(0.10, 0.0)]
