"""
Pydantic models for the ingestion layer.
Defines the canonical Fill model used throughout the pipeline.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class Fill(BaseModel):
    """
    A single Hyperliquid fill (trade execution).

    Raw API shape per item::

        {"coin": "ETH", "px": "2341.5", "sz": "0.5", "side": "B",
         "time": 1704067200000, "fee": "0.234", "oid": 123456,
         "tid": "abc123", "crossed": true}
    """

    wallet: str = Field(..., description="Wallet address (0x…)")
    coin: str = Field(..., description="Asset symbol, e.g. ETH, BTC")
    side: str = Field(..., description="Trade side: 'B' (buy) or 'A' (sell)")
    price: float = Field(..., ge=0, description="Execution price")
    size: float = Field(..., ge=0, description="Fill size in base asset units")
    fee: float = Field(default=0.0, description="Fee paid in USD")
    order_id: Optional[int] = Field(default=None, description="Order ID (oid)")
    trade_id: Optional[str] = Field(default=None, description="Trade ID (tid)")
    crossed: bool = Field(default=False, description="Whether the order crossed the spread")
    ts: datetime = Field(..., description="Fill timestamp (UTC)")

    @field_validator("wallet", mode="before")
    @classmethod
    def normalise_wallet(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("coin", mode="before")
    @classmethod
    def normalise_coin(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("side", mode="before")
    @classmethod
    def normalise_side(cls, v: str) -> str:
        """Accept 'B'/'A', 'Buy'/'Sell', 'buy'/'sell'."""
        v = v.strip().upper()
        if v in ("B", "BUY"):
            return "B"
        if v in ("A", "SELL", "S"):
            return "A"
        return v

    @property
    def notional(self) -> float:
        return self.price * self.size

    @classmethod
    def from_api(cls, raw: dict, wallet: str) -> "Fill":
        """
        Parse a fill from the Hyperliquid REST API response.

        Expected shape::

            {"coin": "ETH", "px": "2341.5", "sz": "0.5", "side": "B",
             "time": 1704067200000, "fee": "0.234", "oid": 123456,
             "tid": "abc123", "crossed": true}
        """
        return cls(
            wallet=wallet,
            coin=raw["coin"],
            side=raw["side"],
            price=float(raw["px"]),
            size=abs(float(raw["sz"])),
            fee=float(raw.get("fee", "0")),
            order_id=raw.get("oid"),
            trade_id=str(raw["tid"]) if raw.get("tid") else None,
            crossed=raw.get("crossed", False),
            ts=datetime.fromtimestamp(raw["time"] / 1000, tz=timezone.utc),
        )

    def to_db_row(self) -> dict:
        """Convert to a dict matching the DB insert shape used by DBWriter."""
        return {
            "wallet": self.wallet,
            "coin": self.coin,
            "side": self.side,
            "price": self.price,
            "size": self.size,
            "fee": self.fee,
            "order_id": str(self.order_id) if self.order_id is not None else None,
            "trade_id": self.trade_id,
            "crossed": self.crossed,
            "ts": self.ts,
        }
