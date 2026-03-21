"""
Historical fill backfill for Hyperliquid.

Reads wallet addresses from ``wallets.txt`` (one per line), fetches all
fills from the Hyperliquid REST API in 7-day chunks going back 90 days,
and writes them to TimescaleDB via :class:`DBWriter`.

Features
--------
- **Resumable**: progress is checkpointed to a local JSON file
  (``backfill_progress.json``).  If interrupted, re-running picks up
  where it left off.
- **Rate-limited**: 10 requests / second via ``asyncio-throttle``.
- **429-safe**: exponential back-off on HTTP 429 responses (up to 60 s).
- **Logged**: per-wallet progress with fill count and elapsed time.

Usage::

    python -m ingestion.historical_backfill
    python -m ingestion.historical_backfill --wallets wallets.txt --days 90
    python -m ingestion.historical_backfill --reset   # clear progress file
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import httpx
from asyncio_throttle import Throttler

from .config import Config
from .db_writer import DBWriter
from .models import Fill

log = logging.getLogger("nexxore.historical_backfill")

# ── defaults ──────────────────────────────────────────────

DEFAULT_WALLETS_FILE = Path(__file__).parent / "wallets.txt"
DEFAULT_PROGRESS_FILE = Path(__file__).parent / "backfill_progress.json"
CHUNK_DAYS = 7
DEFAULT_LOOKBACK_DAYS = 90
REQUESTS_PER_SECOND = 10
MAX_BACKOFF_SECONDS = 60
HL_PAGE_SIZE = 2000  # max fills per API call


# ── progress tracker ──────────────────────────────────────


class ProgressTracker:
    """
    Persist per-wallet backfill progress to a JSON file so the
    process can resume after interruption.

    Shape::

        {
          "wallets": {
            "0xabc…": {
              "last_end_ms": 1711843200000,
              "fills_fetched": 1234,
              "completed": true
            }
          }
        }
    """

    def __init__(self, path: Path = DEFAULT_PROGRESS_FILE) -> None:
        self.path = path
        self._data: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        if self.path.exists():
            try:
                with open(self.path) as f:
                    raw = json.load(f)
                self._data = raw.get("wallets", {})
                log.info(
                    "Loaded progress for %d wallets from %s",
                    len(self._data),
                    self.path.name,
                )
            except (json.JSONDecodeError, KeyError):
                log.warning("Corrupt progress file — starting fresh")
                self._data = {}
        else:
            self._data = {}

    def save(self) -> None:
        with open(self.path, "w") as f:
            json.dump({"wallets": self._data}, f, indent=2)

    def get_wallet(self, wallet: str) -> dict[str, Any] | None:
        return self._data.get(wallet.lower())

    def update_wallet(
        self,
        wallet: str,
        last_end_ms: int,
        fills_fetched: int,
        completed: bool = False,
    ) -> None:
        key = wallet.lower()
        existing = self._data.get(key, {"fills_fetched": 0})
        self._data[key] = {
            "last_end_ms": last_end_ms,
            "fills_fetched": existing["fills_fetched"] + fills_fetched,
            "completed": completed,
        }
        self.save()

    def is_completed(self, wallet: str) -> bool:
        entry = self._data.get(wallet.lower())
        return bool(entry and entry.get("completed"))

    def reset(self) -> None:
        self._data = {}
        if self.path.exists():
            self.path.unlink()
        log.info("Progress file cleared")


# ── core backfill logic ──────────────────────────────────


async def fetch_fills_chunk(
    client: httpx.AsyncClient,
    throttler: Throttler,
    rest_url: str,
    wallet: str,
    start_ms: int,
    end_ms: int,
) -> list[dict]:
    """
    Fetch fills for *wallet* between *start_ms* and *end_ms* (millis).
    Paginates internally until all fills in the window are retrieved.
    Handles 429 with exponential back-off.
    """
    all_fills: list[dict] = []
    cursor_start = start_ms
    backoff = 1.0

    while cursor_start < end_ms:
        async with throttler:
            try:
                resp = await client.post(
                    rest_url,
                    json={
                        "type": "userFillsByTime",
                        "user": wallet,
                        "startTime": cursor_start,
                        "endTime": end_ms,
                    },
                    timeout=15,
                )

                if resp.status_code == 429:
                    wait = min(backoff, MAX_BACKOFF_SECONDS)
                    log.warning(
                        "429 rate-limited — backing off %.1fs (wallet=%s)",
                        wait,
                        wallet[:10],
                    )
                    await asyncio.sleep(wait)
                    backoff *= 2
                    continue

                resp.raise_for_status()
                backoff = 1.0  # reset on success

                fills = resp.json()
                if not fills:
                    break

                all_fills.extend(fills)

                # Advance cursor past the last fill we received
                last_time = max(f["time"] for f in fills)
                cursor_start = last_time + 1

                # If we got fewer than a full page, we've exhausted
                # this window
                if len(fills) < HL_PAGE_SIZE:
                    break

            except httpx.HTTPStatusError as exc:
                log.error(
                    "HTTP %d for wallet %s — skipping chunk",
                    exc.response.status_code,
                    wallet[:10],
                )
                break
            except httpx.RequestError as exc:
                wait = min(backoff, MAX_BACKOFF_SECONDS)
                log.warning(
                    "Request error (%s) — retrying in %.1fs",
                    exc,
                    wait,
                )
                await asyncio.sleep(wait)
                backoff *= 2

    return all_fills


async def backfill_wallet(
    client: httpx.AsyncClient,
    throttler: Throttler,
    writer: DBWriter,
    progress: ProgressTracker,
    config: Config,
    wallet: str,
    lookback_days: int,
) -> int:
    """
    Backfill a single wallet in 7-day chunks, oldest → newest.
    Returns total fills fetched.
    """
    now = datetime.now(timezone.utc)
    global_start = now - timedelta(days=lookback_days)
    global_end = now

    global_start_ms = int(global_start.timestamp() * 1000)
    global_end_ms = int(global_end.timestamp() * 1000)

    # Check resume point
    prev = progress.get_wallet(wallet)
    if prev and prev.get("last_end_ms"):
        resume_ms = prev["last_end_ms"]
        if resume_ms >= global_end_ms:
            log.info("  %s already completed — skipping", wallet[:10])
            return 0
        # Resume from where we left off
        global_start_ms = resume_ms
        log.info(
            "  Resuming %s from %s",
            wallet[:10],
            datetime.fromtimestamp(resume_ms / 1000, tz=timezone.utc).isoformat(),
        )

    # Split into 7-day chunks
    chunk_ms = CHUNK_DAYS * 24 * 60 * 60 * 1000
    total_fills = 0
    chunk_start = global_start_ms

    while chunk_start < global_end_ms:
        chunk_end = min(chunk_start + chunk_ms, global_end_ms)

        raw_fills = await fetch_fills_chunk(
            client,
            throttler,
            config.rest_url,
            wallet,
            chunk_start,
            chunk_end,
        )

        # Parse and write
        for raw in raw_fills:
            fill = Fill.from_api(raw, wallet)
            await writer.write_fill(fill)

        total_fills += len(raw_fills)

        # Checkpoint progress
        progress.update_wallet(
            wallet,
            last_end_ms=chunk_end,
            fills_fetched=len(raw_fills),
            completed=False,
        )

        if raw_fills:
            log.debug(
                "  Chunk %s→%s: %d fills",
                datetime.fromtimestamp(
                    chunk_start / 1000, tz=timezone.utc
                ).strftime("%Y-%m-%d"),
                datetime.fromtimestamp(
                    chunk_end / 1000, tz=timezone.utc
                ).strftime("%Y-%m-%d"),
                len(raw_fills),
            )

        chunk_start = chunk_end

    # Flush remaining buffer and mark complete
    await writer.flush()
    progress.update_wallet(
        wallet,
        last_end_ms=global_end_ms,
        fills_fetched=0,
        completed=True,
    )

    return total_fills


# ── wallet file reader ────────────────────────────────────


def load_wallets(path: Path) -> list[str]:
    """Read wallet addresses from a text file (one per line)."""
    if not path.exists():
        log.error("Wallet file not found: %s", path)
        sys.exit(1)

    wallets = []
    with open(path) as f:
        for line in f:
            addr = line.strip()
            if addr and not addr.startswith("#"):
                wallets.append(addr)

    log.info("Loaded %d wallets from %s", len(wallets), path.name)
    return wallets


# ── main entry ────────────────────────────────────────────


async def run(
    wallets_file: Path = DEFAULT_WALLETS_FILE,
    progress_file: Path = DEFAULT_PROGRESS_FILE,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    reset: bool = False,
) -> None:
    """Run the historical backfill pipeline."""

    config = Config()
    progress = ProgressTracker(progress_file)

    if reset:
        progress.reset()

    wallets = load_wallets(wallets_file)
    if not wallets:
        log.error("No wallets to process")
        return

    # Skip already-completed wallets
    pending = [w for w in wallets if not progress.is_completed(w)]
    log.info(
        "Backfill: %d wallets total, %d pending, %d already done, %d-day lookback",
        len(wallets),
        len(pending),
        len(wallets) - len(pending),
        lookback_days,
    )

    if not pending:
        log.info("All wallets already backfilled — nothing to do")
        return

    writer = DBWriter(config)
    await writer.connect()

    throttler = Throttler(rate_limit=REQUESTS_PER_SECOND, period=1.0)

    grand_total = 0
    t0 = time.monotonic()

    async with httpx.AsyncClient() as client:
        for i, wallet in enumerate(pending, 1):
            wallet_t0 = time.monotonic()

            log.info(
                "[%d/%d] Backfilling %s …",
                i,
                len(pending),
                wallet[:10],
            )

            try:
                count = await backfill_wallet(
                    client,
                    throttler,
                    writer,
                    progress,
                    config,
                    wallet,
                    lookback_days,
                )
                grand_total += count
                elapsed = time.monotonic() - wallet_t0

                log.info(
                    "[%d/%d] %s — %d fills in %.1fs",
                    i,
                    len(pending),
                    wallet[:10],
                    count,
                    elapsed,
                )
            except Exception as exc:
                log.error(
                    "[%d/%d] %s — FAILED: %s",
                    i,
                    len(pending),
                    wallet[:10],
                    exc,
                )

    await writer.close()

    total_elapsed = time.monotonic() - t0
    log.info(
        "Backfill complete: %d fills across %d wallets in %.1fs (%.0f fills/s)",
        grand_total,
        len(pending),
        total_elapsed,
        grand_total / max(total_elapsed, 0.1),
    )


# ── CLI ───────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Historical Hyperliquid fill backfill"
    )
    parser.add_argument(
        "--wallets",
        type=Path,
        default=DEFAULT_WALLETS_FILE,
        help="Path to wallets.txt (one address per line)",
    )
    parser.add_argument(
        "--progress",
        type=Path,
        default=DEFAULT_PROGRESS_FILE,
        help="Path to progress checkpoint JSON",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=DEFAULT_LOOKBACK_DAYS,
        help="How many days to look back (default: 90)",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Clear progress file and start from scratch",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable DEBUG logging",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s  %(name)-30s  %(levelname)-7s  %(message)s",
        datefmt="%H:%M:%S",
    )

    asyncio.run(
        run(
            wallets_file=args.wallets,
            progress_file=args.progress,
            lookback_days=args.days,
            reset=args.reset,
        )
    )


if __name__ == "__main__":
    main()
