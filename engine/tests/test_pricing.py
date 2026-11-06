import math

import pytest

from pricing import aqua_equivalent, aqua_position, bs_greeks, bs_price

T7 = 7 / 365


def test_atm_7_day_call_known_value():
    # r = 0, S = K = 3000, sigma = 60%, T = 7/365. Closed form for ATM with r = 0:
    # S * (2 N(sigma sqrt(T) / 2) - 1) = 99.42. (The PRD's "about $99.7" is ~0.3% high.)
    assert bs_price(3000, 3000, T7, 0.60, True) == pytest.approx(99.42, abs=0.01)


def test_put_call_parity():
    for K in (2500, 3000, 3600):
        call = bs_price(3000, K, T7, 0.6, True)
        put = bs_price(3000, K, T7, 0.6, False)
        assert call - put == pytest.approx(3000 - K, abs=1e-9)


def test_expired_option_is_intrinsic():
    assert bs_price(3100, 3000, 0, 0.6, True) == 100
    assert bs_price(3100, 3000, 0, 0.6, False) == 0


@pytest.mark.parametrize("is_call", [True, False])
def test_greeks_match_finite_differences(is_call):
    S, K, T, v = 3000, 3100, 30 / 365, 0.6
    g = bs_greeks(S, K, T, v, is_call)
    h = 0.01
    price = lambda s=S, t=T, vol=v: bs_price(s, K, t, vol, is_call)
    assert g.delta == pytest.approx((price(S + h) - price(S - h)) / (2 * h), rel=1e-5)
    assert g.gamma == pytest.approx((price(S + 1) - 2 * price() + price(S - 1)), rel=1e-3)
    assert g.vega == pytest.approx((price(vol=v + 1e-4) - price(vol=v - 1e-4)) / 2e-4 / 100, rel=1e-5)
    assert g.theta == pytest.approx((price(t=T - 1e-5) - price(t=T + 1e-5)) / 2e-5 / 365, rel=1e-4)


def test_aqua_equivalent_strike_and_term():
    k, t = aqua_equivalent(3400, 3600, 0.65)
    assert k == pytest.approx(math.sqrt(3400 * 3600))
    r = math.sqrt(3600 / 3400)
    assert t == pytest.approx(2 * math.pi / 0.65**2 * ((math.sqrt(r) - 1) / (math.sqrt(r) + 1)) ** 2)
    assert t * 365 == pytest.approx(0.277, abs=0.001)  # ~0.28 days for a ~6% range at 65% vol


def test_aqua_equivalent_term_grows_with_range_width():
    _, narrow = aqua_equivalent(3400, 3500, 0.65)
    _, wide = aqua_equivalent(3400, 4000, 0.65)
    assert wide > narrow


@pytest.mark.parametrize(
    "side, low, high",
    [("call_like", 3300, 3500), ("put_like", 3000, 3500), ("straddle", 3400, 3600)],
)
def test_aqua_position_rejects_ranges_on_the_wrong_side_of_spot(side, low, high):
    with pytest.raises(ValueError):
        aqua_position(3386, low, high, side, 1.0, 0.65)


def test_aqua_covered_call_and_cash_secured_put_greeks():
    call = aqua_position(3386, 3400, 3600, "call_like", 2.0, 0.65)
    put = aqua_position(3386, 3100, 3300, "put_like", 2.0, 0.65)
    # Covered call: long ETH, short the call -> delta in (0, q), short gamma and vega.
    assert 0 < call["position_greeks"].delta < 2.0
    assert call["position_greeks"].gamma < 0 and call["position_greeks"].vega < 0
    # Cash-secured put: short put -> positive delta, short gamma and vega, earns theta.
    assert put["position_greeks"].delta > 0
    assert put["position_greeks"].theta > 0
    assert put["collateral"] == pytest.approx(2.0 * math.sqrt(3100 * 3300))
