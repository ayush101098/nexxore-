from datetime import datetime, timezone
from decimal import Decimal

from scanner import VenueQuote, fillable_usd, scan

T = datetime(2026, 11, 6, 9, 30, tzinfo=timezone.utc)
REF = VenueQuote("oracle", None, Decimal("3400"), T, "test:oracle", reference=True)


def curve(price: str, eth: str | None, usdc: str | None) -> VenueQuote:
    return VenueQuote(
        "aqua", "aqua", Decimal(price), T, "test:aqua",
        eth_balance=None if eth is None else Decimal(eth),
        usdc_balance=None if usdc is None else Decimal(usdc),
    )


class Fixed:
    name = "fixed"

    def __init__(self, *quotes):
        self._quotes = [REF, *quotes]

    def quotes(self, pair, as_of):
        return self._quotes


def test_above_reference_is_capped_by_usdc():
    assert fillable_usd(curve("3410", "5", "1200"), REF.price) == Decimal("1200")


def test_below_reference_is_capped_by_eth_value():
    assert fillable_usd(curve("3390", "0.5", "0"), REF.price) == Decimal("1695.0")


def test_uncapped_without_balances():
    assert fillable_usd(curve("3390", None, None), REF.price) is None


def test_one_sided_curve_in_the_unfillable_direction_is_dropped():
    # ETH-only curve priced above reference: the gap says sell ETH to it, but it has no USDC.
    assert scan("ETH/USDC", [Fixed(curve("3410", "1", "0"))], T, Decimal("10000"), Decimal("5")) == []


def test_size_is_capped():
    [opp] = scan("ETH/USDC", [Fixed(curve("3390", "0.5", "0"))], T, Decimal("10000"), Decimal("5"))
    assert opp["size"] == "1695.00"


def test_read_holdings_decodes_weth_and_usdc():
    from scanner.holdings import read_holdings

    seen = {}

    def post(url, body):
        seen["url"], seen["body"] = url, body
        return [{"id": 1, "result": hex(5_000 * 10**6)}, {"id": 0, "result": hex(2 * 10**18)}]

    h = read_holdings("http://127.0.0.1:8545", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", post=post)
    assert (h.weth, h.usdc) == (2, 5000)
    assert seen["body"][0]["params"][0]["data"].endswith("f39fd6e51aad88f6f4ce6ab8827279cfffb92266")
