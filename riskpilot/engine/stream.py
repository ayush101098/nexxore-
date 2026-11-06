"""Block stream and push events (hardening section 4).

BlockWatcher follows the chain head: newHeads over WebSocket, falling back to polling
eth_blockNumber every 2 s. On each new block, and when the newest decisions for a wallet
are about to expire, it re-evaluates every subscribed wallet (scan, evaluate, size) and
publishes the result. The engine is the only reader of market state; the page only listens.

Hub fans events out to /v1/stream subscribers as server-sent events:
  block, opportunity (a wallet's full set of evaluated opportunities), decision, health, settlement.
"""

import asyncio
import json
import logging
import threading
import time
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

log = logging.getLogger("riskpilot")

POLL_S = 2.0
REFRESH_S = 15.0  # re-issue a wallet's decisions at half the 30 s TTL when no block arrives
HEARTBEAT_S = 15.0


class Hub:
    def __init__(self):
        self._subs: list[tuple[asyncio.Queue, str | None, asyncio.AbstractEventLoop]] = []
        self._lock = threading.Lock()

    def subscribe(self, wallet: str | None) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        with self._lock:
            self._subs.append((q, wallet.lower() if wallet else None, asyncio.get_running_loop()))
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        with self._lock:
            self._subs = [s for s in self._subs if s[0] is not q]

    def wallets(self) -> set[str]:
        with self._lock:
            return {w for _, w, _ in self._subs if w}

    def publish(self, event: str, data: dict, wallet: str | None = None) -> None:
        """Thread-safe. wallet=None goes to every subscriber; otherwise only that wallet's."""
        msg = f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"
        with self._lock:
            subs = list(self._subs)
        for q, w, loop in subs:
            if wallet is None or w == wallet.lower():
                loop.call_soon_threadsafe(_offer, q, msg)


def _offer(q: asyncio.Queue, msg: str) -> None:
    if q.full():  # a slow client loses its oldest event, never blocks the engine
        q.get_nowait()
    q.put_nowait(msg)


def _rpc(url: str, method: str, params: list | None = None, timeout: float = 1.5):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}).encode()
    req = urllib.request.Request(url, body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        reply = json.load(r)
    if "error" in reply:
        raise RuntimeError(reply["error"])
    return reply["result"]


class Sources:
    """Parallel reads with a 1.5 s timeout each; three straight failures mark a source unavailable
    (it is retried on the next block, and one success clears it)."""

    TIMEOUT_S = 1.5
    STRIKES = 3

    def __init__(self):
        self._pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="read")
        self.strikes: dict[str, int] = {}
        self.errors: dict[str, str] = {}

    def run(self, reads: dict[str, Callable[[], object]]) -> dict[str, object]:
        futures = {name: self._pool.submit(fn) for name, fn in reads.items()}
        out = {}
        for name, f in futures.items():
            try:
                out[name] = f.result(timeout=self.TIMEOUT_S)
                self.strikes[name] = 0
                self.errors.pop(name, None)
            except FutureTimeout:
                out[name] = TimeoutError(f"{name}: no reply in {self.TIMEOUT_S} s")
            except Exception as e:  # noqa: BLE001 - the caller reports the source as unavailable
                out[name] = e
            if isinstance(out[name], Exception):
                self.strikes[name] = self.strikes.get(name, 0) + 1
                self.errors[name] = str(out[name])
        return out

    def unavailable(self) -> list[str]:
        return sorted(n for n, k in self.strikes.items() if k >= self.STRIKES)


class BlockWatcher(threading.Thread):
    def __init__(self, rpc_url: str, hub: Hub, on_block: Callable[[int], None], refresh: Callable[[], None],
                 on_health: Callable[[], dict]):
        super().__init__(daemon=True, name="block-watcher")
        self.rpc_url, self.hub = rpc_url, hub
        self.on_block, self.refresh, self.on_health = on_block, refresh, on_health
        self.block: int | None = None
        self.block_seen_at: float | None = None
        self.mode = "starting"
        self.chain_up = False
        self._stop = threading.Event()
        self._last_refresh = time.monotonic()
        self._last_health = 0.0

    def stop(self) -> None:
        self._stop.set()

    def _head(self, n: int) -> None:
        if n == self.block:
            return
        self.block, self.block_seen_at = n, time.time()
        self.hub.publish("block", {"block": n, "at": self.block_seen_at, "mode": self.mode})
        self._last_refresh = time.monotonic()
        self.on_block(n)

    def _chain(self, up: bool) -> None:
        if up != self.chain_up:
            self.chain_up = up
            self.hub.publish("health", self.on_health())  # a source change is pushed at once

    def _tick(self) -> None:
        now = time.monotonic()
        if now - self._last_refresh >= REFRESH_S:
            self._last_refresh = now
            self.refresh()
        if now - self._last_health >= HEARTBEAT_S:
            self._last_health = now
            self.hub.publish("health", self.on_health())

    def _ws(self) -> bool:
        """newHeads over WebSocket until it drops. False if it never connected."""
        try:
            from websockets.sync.client import connect
        except ImportError:
            return False
        url = self.rpc_url.replace("http://", "ws://").replace("https://", "wss://")
        try:
            with connect(url, open_timeout=1.5, close_timeout=1) as ws:
                ws.send(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_subscribe", "params": ["newHeads"]}))
                json.loads(ws.recv(timeout=1.5))
                self.mode = "websocket newHeads"
                self._chain(True)
                self._head(int(_rpc(self.rpc_url, "eth_blockNumber"), 16))
                while not self._stop.is_set():
                    try:
                        msg = json.loads(ws.recv(timeout=1.0))
                    except TimeoutError:
                        self._tick()
                        continue
                    head = msg.get("params", {}).get("result", {})
                    if "number" in head:
                        self._head(int(head["number"], 16))
                    self._tick()
        except Exception as e:  # noqa: BLE001 - fall back to polling
            log.info(json.dumps({"event": "ws_down", "error": str(e)}))
            return self.mode == "websocket newHeads"
        return True

    def run(self) -> None:
        while not self._stop.is_set():
            if self._ws():
                self.mode = "reconnecting"
                self._chain(False)
                continue
            # Polling fallback; try the WebSocket again every 30 s.
            self.mode = f"polling every {POLL_S:g} s"
            until = time.monotonic() + 30
            while not self._stop.is_set() and time.monotonic() < until:
                try:
                    self._head(int(_rpc(self.rpc_url, "eth_blockNumber"), 16))
                    self._chain(True)
                except Exception:  # noqa: BLE001
                    self._chain(False)
                self._tick()
                self._stop.wait(POLL_S)
