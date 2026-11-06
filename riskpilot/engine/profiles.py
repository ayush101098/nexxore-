"""Risk profiles, chosen once per wallet. Starting values for the demo, not calibrated settings.

Every profile parameter is fixed here; nothing is a slider. What changes block by block is
derived from the wallet and the market (derive()): the stress budget, the slippage tolerance,
the position size cap and the gas ceiling.
"""

from dataclasses import dataclass
from decimal import Decimal

TTL_S = 30  # decision TTL, all profiles
STALENESS_S = 30  # max input age, all profiles
REQUOTE_MOVE = Decimal("0.003")  # requote past a 0.3% move, all profiles
SLIPPAGE_PAD = Decimal("0.0005")  # 5 bp over the simulated impact


@dataclass(frozen=True)
class Profile:
    name: str
    lam: Decimal  # price of risk: $ charged per $ of added worst-case stress loss
    budget_share: Decimal  # stress budget as a share of wallet value ...
    budget_cap: Decimal  # ... capped at this
    min_edge: Decimal
    k: Decimal  # net edge must also clear k x edge uncertainty
    aqua_margin: Decimal  # Aqua premium floor markup m: fee >= (1 + m) C_eq / K_eq
    max_slippage: Decimal
    max_position_share: Decimal  # largest position as a share of wallet value

    @property
    def label(self) -> str:
        return self.name.capitalize()

    @property
    def budget(self) -> Decimal:
        """The budget when the wallet is large enough for the cap to bind."""
        return self.budget_cap


PROFILES = {
    p.name: p
    for p in (
        Profile("conservative", Decimal("1.0"), Decimal("0.01"), Decimal("150.00"), Decimal("10.00"), Decimal("3"),
                Decimal("0.50"), Decimal("0.0030"), Decimal("0.10")),
        Profile("moderate", Decimal("0.5"), Decimal("0.025"), Decimal("250.00"), Decimal("5.00"), Decimal("2"),
                Decimal("0.20"), Decimal("0.0050"), Decimal("0.25")),
        Profile("aggressive", Decimal("0.25"), Decimal("0.05"), Decimal("500.00"), Decimal("3.00"), Decimal("1.5"),
                Decimal("0.10"), Decimal("0.0100"), Decimal("0.50")),
    )
}
ALIASES = {"balanced": "moderate"}  # the pre-hardening name


def get_profile(name: str) -> Profile:
    return PROFILES[ALIASES.get(name, name)]


def stress_budget(profile: Profile, wallet_value: Decimal | None) -> tuple[Decimal, str]:
    """min(share x wallet value, cap), and which of the two bound."""
    if wallet_value is None:
        return profile.budget_cap, "cap"
    share = (profile.budget_share * wallet_value).quantize(Decimal("0.01"))
    return (share, "share") if share < profile.budget_cap else (profile.budget_cap, "cap")


def derive(profile: Profile, wallet_value: Decimal | None, impact: Decimal | None = None,
           base_fee_gwei: Decimal | None = None, tip_gwei: Decimal | None = None) -> dict:
    """The values a decision is made with this block, with how each was derived."""
    budget, bound = stress_budget(profile, wallet_value)
    out = {
        "profile": profile.name,
        "wallet_value": None if wallet_value is None else str(wallet_value.quantize(Decimal("0.01"))),
        "budget": str(budget),
        "budget_bound": bound,
        "budget_rule": f"min({profile.budget_share:.1%} x wallet value, ${profile.budget_cap:,.0f})",
        "max_position": None if wallet_value is None else str((profile.max_position_share * wallet_value).quantize(Decimal("0.01"))),
        "ttl_s": TTL_S,
        "staleness_s": STALENESS_S,
        "requote_move": str(REQUOTE_MOVE),
    }
    if impact is not None:
        out["slippage_tolerance"] = str(min(profile.max_slippage, impact + SLIPPAGE_PAD).quantize(Decimal("0.000001")))
    if base_fee_gwei is not None:
        out["gas_ceiling_gwei"] = str((2 * base_fee_gwei + (tip_gwei or 0)).quantize(Decimal("0.000000001")))
        out["tip_gwei"] = str((tip_gwei or Decimal(0)).quantize(Decimal("0.000000001")))
    return out
