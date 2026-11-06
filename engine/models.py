"""Request envelopes for the engine's own endpoints.

Opportunity, Position and Execution bodies are plain dicts validated against
shared/schemas. The market snapshot is engine input only, so it lives here.
"""

from decimal import Decimal
from typing import Literal

from jsonschema import ValidationError
from pydantic import AwareDatetime, BaseModel, ConfigDict, field_validator, model_validator

from schemas import validate


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _shared(name: str, obj: dict) -> dict:
    # pydantic only turns ValueError into a 422, so re-raise schema errors as one.
    try:
        validate(name, obj)
    except ValidationError as e:
        raise ValueError(f"{name}: {e.message}") from None
    return obj


class Quote(_Model):
    price: Decimal  # average execution price at the trade size
    mid: Decimal
    quoted_at: AwareDatetime
    expires_at: AwareDatetime
    latency_seconds: Decimal
    source: str


class Gas(_Model):
    units: Decimal  # from simulation
    price_gwei: Decimal
    observed_at: AwareDatetime
    source: str


class Volatility(_Model):
    annualized: Decimal
    observed_at: AwareDatetime
    source: str


class Hedge(_Model):
    ratio: Decimal = Decimal("0")  # share of the trade's delta closed by the hedge leg
    cost: Decimal = Decimal("0")


class Market(_Model):
    quote: Quote
    liquidity: Decimal  # USD fillable at the quote
    gas: Gas
    fee_rate: Decimal  # pool fee at execution time; the hook's current fee for the hooked pool
    volatility: Volatility
    hedge: Hedge = Hedge()


class AquaCurveParams(_Model):
    """The curve an aqua_premium decision would ship; market.fee_rate is its Fee instruction."""

    side: Literal["call_like", "put_like"]
    range_low: Decimal
    range_high: Decimal


class Holdings(_Model):
    """Wallet balances. WETH counts in the before-book as spot ETH, so a curve funded
    from held ETH is measured against the ETH risk the wallet already carried."""

    weth: Decimal = Decimal("0")
    usdc: Decimal = Decimal("0")


Profile = Literal["conservative", "balanced", "aggressive"]


class EvaluateRequest(_Model):
    """Fully resolved /evaluate input. Every field the verdict depends on is here."""

    opportunity: dict
    size: Decimal
    profile: Profile
    market: Market
    book: list[dict] = []
    as_of: AwareDatetime
    tolerance: Decimal = Decimal("0.003")
    gas_budget: Decimal = Decimal("25.00")
    aqua: AquaCurveParams | None = None  # required for aqua_premium opportunities
    holdings: Holdings | None = None  # None: the trade is measured against the book alone

    @field_validator("opportunity")
    @classmethod
    def _opportunity(cls, v: dict) -> dict:
        return _shared("opportunity", v)

    @model_validator(mode="after")
    def _aqua_params(self) -> "EvaluateRequest":
        if self.opportunity["type"] == "aqua_premium" and self.aqua is None:
            raise ValueError("aqua_premium opportunities need aqua curve params")
        return self

    @field_validator("book")
    @classmethod
    def _book(cls, v: list[dict]) -> list[dict]:
        return [_shared("position", p) for p in v]


class EvaluateBody(_Model):
    """What a caller may send; the API fills the gaps before evaluating."""

    opportunity: dict
    size: Decimal | None = None  # default: the opportunity's size
    profile: Profile = "balanced"
    market: Market | None = None  # default: fetched from the scanner source
    book: list[dict] | None = None  # default: open positions in the store
    as_of: AwareDatetime | None = None  # default: now
    tolerance: Decimal = Decimal("0.003")
    gas_budget: Decimal = Decimal("25.00")
    aqua: AquaCurveParams | None = None
    holdings: Holdings | None = None  # default: read `wallet` over RPC when given
    wallet: str | None = None


class ScanBody(_Model):
    pair: str = "ETH/USDC"
    sources: list[str] = ["recorded"]
    size: Decimal = Decimal("10000.00")
    min_gap_bps: Decimal = Decimal("5")
    as_of: AwareDatetime | None = None


class AquaPriceBody(_Model):
    spot: Decimal
    range_low: Decimal
    range_high: Decimal
    side: Literal["call_like", "put_like"]
    size: Decimal  # ETH
    volatility: Decimal


class StressBody(_Model):
    positions: list[dict]
    spot: Decimal | None = None  # default: each position's entry price

    @field_validator("positions")
    @classmethod
    def _positions(cls, v: list[dict]) -> list[dict]:
        return [_shared("position", p) for p in v]
