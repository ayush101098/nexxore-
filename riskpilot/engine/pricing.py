"""Black-Scholes pricing, Greeks, and the Aqua curve -> equivalent option mapping.

Conventions are ported from the Nexxore strategy builder (tag pre-eth-global):
r = 0 (Black-76 style on a crypto spot), theta per calendar day, vega per
volatility point (1% absolute).
"""

import math
from dataclasses import asdict, dataclass

from scipy.special import ndtr

DAYS_PER_YEAR = 365


def _n_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def _d1_d2(S: float, K: float, T: float, sigma: float) -> tuple[float, float]:
    sq = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + 0.5 * sigma * sigma * T) / sq
    return d1, d1 - sq


def bs_price(S: float, K: float, T: float, sigma: float, is_call: bool) -> float:
    if T <= 0 or sigma <= 0:
        return max(0.0, S - K) if is_call else max(0.0, K - S)
    d1, d2 = _d1_d2(S, K, T, sigma)
    if is_call:
        return S * ndtr(d1) - K * ndtr(d2)
    return K * ndtr(-d2) - S * ndtr(-d1)


@dataclass(frozen=True)
class Greeks:
    delta: float
    gamma: float
    vega: float  # per volatility point
    theta: float  # per calendar day

    def scaled(self, q: float) -> "Greeks":
        return Greeks(self.delta * q, self.gamma * q, self.vega * q, self.theta * q)

    def as_strings(self) -> dict:
        return {k: f"{v:.6f}" for k, v in asdict(self).items()}


def bs_greeks(S: float, K: float, T: float, sigma: float, is_call: bool) -> Greeks:
    if T <= 0 or sigma <= 0:
        itm = S > K if is_call else S < K
        return Greeks((1.0 if is_call else -1.0) if itm else 0.0, 0.0, 0.0, 0.0)
    d1, _ = _d1_d2(S, K, T, sigma)
    sq = sigma * math.sqrt(T)
    pdf = _n_pdf(d1)
    return Greeks(
        delta=ndtr(d1) if is_call else ndtr(d1) - 1,
        gamma=pdf / (S * sq),
        vega=S * pdf * math.sqrt(T) / 100,
        theta=-(S * pdf * sigma) / (2 * math.sqrt(T)) / DAYS_PER_YEAR,
    )


def aqua_equivalent(p_low: float, p_high: float, sigma: float) -> tuple[float, float]:
    """Equivalent strike and term (years) of a concentrated range [p_low, p_high].

    K_eq = sqrt(p_low * p_high), r = sqrt(p_high / p_low),
    T_eq = 2*pi / sigma^2 * ((sqrt(r) - 1) / (sqrt(r) + 1))^2  (Panoptic).
    """
    if not 0 < p_low < p_high:
        raise ValueError("range must satisfy 0 < range_low < range_high")
    if sigma <= 0:
        raise ValueError("volatility must be positive")
    r = math.sqrt(p_high / p_low)
    k_eq = math.sqrt(p_low * p_high)
    t_eq = 2 * math.pi / sigma**2 * ((math.sqrt(r) - 1) / (math.sqrt(r) + 1)) ** 2
    return k_eq, t_eq


PREMIUM_MARKUP = 0.20  # m: a curve's fee must earn at least (1 + m) x its equivalent option value


def aqua_premium_floor(spot: float, p_low: float, p_high: float, side: str, sigma: float, m: float = PREMIUM_MARKUP) -> dict:
    """Aqua premium rule: the minimum curve fee for an options-like curve.

    C_eq is Black-Scholes at K_eq and T_eq (per ETH). A fully crossed range trades
    about one ETH per ETH of size at an average price K_eq, so a fee f earns about
    f * K_eq per ETH; f_min = (1 + m) * C_eq / K_eq makes that cover C_eq plus a margin m.
    """
    k_eq, t_eq = aqua_equivalent(p_low, p_high, sigma)
    c_eq = bs_price(spot, k_eq, t_eq, sigma, side == "call_like")
    return {"k_eq": k_eq, "t_eq": t_eq, "c_eq": c_eq, "f_min": (1 + m) * c_eq / k_eq, "markup": m}


def aqua_position(
    spot: float, p_low: float, p_high: float, side: str, q: float, sigma: float, strict: bool = True
) -> dict:
    """Options-like view of one Aqua curve holding q ETH of exposure.

    call_like: range above spot holding q ETH, sold as price rises
               -> long q ETH + short q calls at K_eq (covered call).
    put_like:  range below spot holding q * K_eq USDC, buying ETH as price falls
               -> short q puts at K_eq (cash-secured put).
    These are options-like payoffs from swap curves, not option contracts.
    strict=False skips the spot-side check, for repricing after spot has moved.
    """
    if strict and side == "call_like" and p_low < spot:
        raise ValueError("call_like range must sit above spot (range_low >= spot)")
    if strict and side == "put_like" and p_high > spot:
        raise ValueError("put_like range must sit below spot (range_high <= spot)")
    if side not in ("call_like", "put_like"):
        raise ValueError("side must be call_like or put_like")
    if q <= 0:
        raise ValueError("size must be positive")

    is_call = side == "call_like"
    k_eq, t_eq = aqua_equivalent(p_low, p_high, sigma)
    option = bs_greeks(spot, k_eq, t_eq, sigma, is_call)
    short = option.scaled(-q)
    if is_call:
        position = Greeks(q + short.delta, short.gamma, short.vega, short.theta)
        collateral = q * spot
    else:
        position = short
        collateral = q * k_eq
    return {
        "equivalent_strike": k_eq,
        "equivalent_term_years": t_eq,
        "equivalent_greeks": option,
        "position_greeks": position,
        "equivalent_premium": q * bs_price(spot, k_eq, t_eq, sigma, is_call),
        "collateral": collateral,
        # Worst case is ETH going to zero: the ETH held (call_like) or the ETH
        # bought with all the USDC (put_like) is worthless.
        "max_loss": collateral,
    }
