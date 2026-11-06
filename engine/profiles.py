"""Risk profiles. Starting values for the demo, not calibrated settings."""

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Profile:
    name: str
    lam: Decimal  # price of risk: $ charged per $ of added worst-case stress loss
    budget: Decimal  # max post-trade worst stress loss
    min_edge: Decimal
    k: Decimal  # net edge must also clear k x edge uncertainty


PROFILES = {
    p.name: p
    for p in (
        Profile("conservative", Decimal("1.0"), Decimal("150.00"), Decimal("10.00"), Decimal("3")),
        Profile("balanced", Decimal("0.5"), Decimal("250.00"), Decimal("5.00"), Decimal("2")),
        Profile("aggressive", Decimal("0.25"), Decimal("500.00"), Decimal("3.00"), Decimal("1.5")),
    )
}
