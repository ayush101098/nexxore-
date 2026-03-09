"""
Nexxore Dexscreener API Client
================================
Async HTTP client with sliding-window rate limiting, retry logic,
and response normalization. Wraps all Dexscreener v1 endpoints.
"""

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx

from ..config import config
from ..models import PairData

logger = logging.getLogger("nexxore.market-data.dexscreener")


class RateLimiter:
    """Sliding window rate limiter per bucket."""
    
    def __init__(self, rpm: int):
        self.rpm = rpm
        self.window: List[float] = []
        self._lock = asyncio.Lock()
    
    async def acquire(self):
        """Wait until a request slot is available."""
        async with self._lock:
            now = time.monotonic()
            # Remove entries older than 60s
            self.window = [t for t in self.window if now - t < 60]
            
            if len(self.window) >= self.rpm:
                # Wait until oldest entry expires
                wait_time = 60 - (now - self.window[0]) + 0.1
                if wait_time > 0:
                    logger.debug(f"Rate limit reached, waiting {wait_time:.1f}s")
                    await asyncio.sleep(wait_time)
                    # Clean again after sleep
                    now = time.monotonic()
                    self.window = [t for t in self.window if now - t < 60]
            
            self.window.append(time.monotonic())


class DexscreenerClient:
    """Async Dexscreener API client with built-in rate limiting.
    
    Usage:
        async with DexscreenerClient() as client:
            pairs = await client.search_pairs("SOL/USDC")
            pair = await client.get_pair("solana", "address...")
    """
    
    def __init__(self):
        self.base_url = config.dexscreener.base_url
        self.timeout = config.dexscreener.request_timeout
        self.max_retries = config.dexscreener.max_retries
        
        # Separate rate limiters per Dexscreener bucket
        self._slow_limiter = RateLimiter(config.dexscreener.slow_rpm)
        self._fast_limiter = RateLimiter(config.dexscreener.fast_rpm)
        
        self._client: Optional[httpx.AsyncClient] = None
        
        # Stats
        self._request_count = 0
        self._error_count = 0
        self._start_time = time.time()
    
    async def __aenter__(self):
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout,
            headers={"Accept": "application/json"},
            follow_redirects=True,
        )
        return self
    
    async def __aexit__(self, *args):
        if self._client:
            await self._client.aclose()
    
    async def _get_json(self, path: str, bucket: str = "fast") -> Any:
        """Make a rate-limited GET request with retry logic."""
        limiter = self._fast_limiter if bucket == "fast" else self._slow_limiter
        
        for attempt in range(self.max_retries):
            await limiter.acquire()
            try:
                if not self._client:
                    raise RuntimeError("Client not initialized. Use 'async with' context manager.")
                
                response = await self._client.get(path)
                self._request_count += 1
                
                if response.status_code == 429:
                    # Rate limited - back off
                    retry_after = float(response.headers.get("Retry-After", "5"))
                    logger.warning(f"Rate limited on {path}, retrying after {retry_after}s")
                    await asyncio.sleep(retry_after)
                    continue
                
                response.raise_for_status()
                return response.json()
                
            except httpx.HTTPStatusError as e:
                self._error_count += 1
                if e.response.status_code >= 500 and attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
                logger.error(f"HTTP error on {path}: {e.response.status_code}")
                raise
            except httpx.RequestError as e:
                self._error_count += 1
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
                logger.error(f"Request error on {path}: {e}")
                raise
        
        return None
    
    # ─── Token Discovery Endpoints (slow bucket: 60 rpm) ───────────
    
    async def get_token_profiles_latest(self) -> List[Dict[str, Any]]:
        """Get latest token profiles."""
        data = await self._get_json("/token-profiles/latest/v1", bucket="slow")
        return list(data) if isinstance(data, list) else []
    
    async def get_token_boosts_latest(self) -> List[Dict[str, Any]]:
        """Get latest boosted tokens."""
        data = await self._get_json("/token-boosts/latest/v1", bucket="slow")
        return list(data) if isinstance(data, list) else []
    
    async def get_token_boosts_top(self) -> List[Dict[str, Any]]:
        """Get tokens with most active boosts."""
        data = await self._get_json("/token-boosts/top/v1", bucket="slow")
        return list(data) if isinstance(data, list) else []
    
    async def get_orders(self, chain_id: str, token_address: str) -> Dict[str, Any]:
        """Get paid orders for a token."""
        data = await self._get_json(
            f"/orders/v1/{chain_id}/{token_address}", bucket="slow"
        )
        return data if isinstance(data, dict) else {"orders": data or []}
    
    # ─── Pair Data Endpoints (fast bucket: 300 rpm) ────────────────
    
    async def search_pairs(self, query: str, limit: int = 30) -> List[PairData]:
        """Search Dexscreener pairs by name, symbol, or address."""
        data = await self._get_json(
            f"/latest/dex/search?q={quote(query, safe='')}", bucket="fast"
        )
        pairs_raw = data.get("pairs", []) if isinstance(data, dict) else []
        pairs = [PairData.from_dexscreener(p) for p in pairs_raw[:limit]]
        return pairs
    
    async def get_pair(self, chain_id: str, pair_address: str) -> Optional[PairData]:
        """Get a specific pair by chain and address."""
        data = await self._get_json(
            f"/latest/dex/pairs/{chain_id}/{pair_address}", bucket="fast"
        )
        if isinstance(data, dict):
            pair = data.get("pair")
            if pair:
                return PairData.from_dexscreener(pair)
            pairs = data.get("pairs", [])
            if pairs:
                return PairData.from_dexscreener(pairs[0])
        return None
    
    async def get_token_pairs(self, chain_id: str, token_address: str) -> List[PairData]:
        """Get all pools/pairs for a token."""
        data = await self._get_json(
            f"/token-pairs/v1/{chain_id}/{token_address}", bucket="fast"
        )
        if isinstance(data, list):
            return [PairData.from_dexscreener(p) for p in data]
        return []
    
    async def get_tokens(self, chain_id: str, token_addresses: List[str]) -> List[PairData]:
        """Get pairs for multiple tokens (up to 30 addresses)."""
        # Chunk to max 30 per Dexscreener limit
        all_pairs: List[PairData] = []
        for i in range(0, len(token_addresses), 30):
            chunk = token_addresses[i:i+30]
            addresses = ",".join(chunk)
            data = await self._get_json(
                f"/tokens/v1/{chain_id}/{addresses}", bucket="fast"
            )
            if isinstance(data, list):
                all_pairs.extend([PairData.from_dexscreener(p) for p in data])
        return all_pairs
    
    # ─── Composite Operations ──────────────────────────────────────
    
    async def get_top_movers(self, chains: Optional[List[str]] = None, limit: int = 50) -> List[PairData]:
        """Discover top movers by scanning boosts + profiles.
        
        Collects seed tokens from boosts/profiles, then fetches
        their pair data for complete market information.
        """
        chains = chains or config.poller.default_chains
        
        # Gather seeds from discovery endpoints (parallel)
        boosts_top, boosts_latest, profiles = await asyncio.gather(
            self.get_token_boosts_top(),
            self.get_token_boosts_latest(),
            self.get_token_profiles_latest(),
            return_exceptions=True,
        )
        
        # Collect unique (chain, token) seeds
        seeds: Dict[str, str] = {}  # token_address -> chain_id
        
        for source in [boosts_top, boosts_latest, profiles]:
            if isinstance(source, Exception):
                logger.warning(f"Discovery endpoint failed: {source}")
                continue
            for item in source:
                chain = item.get("chainId", "")
                token = item.get("tokenAddress", "")
                if chain in chains and token and token not in seeds:
                    seeds[token] = chain
        
        logger.info(f"Discovered {len(seeds)} seed tokens from boosts/profiles")
        
        # Fetch pair data for seeds (grouped by chain)
        by_chain: Dict[str, List[str]] = {}
        for token, chain in seeds.items():
            by_chain.setdefault(chain, []).append(token)
        
        all_pairs: List[PairData] = []
        for chain, tokens in by_chain.items():
            try:
                pairs = await self.get_tokens(chain, tokens)
                all_pairs.extend(pairs)
            except Exception as e:
                logger.error(f"Failed to fetch pairs for {chain}: {e}")
        
        # Sort by volume and return top N
        all_pairs.sort(key=lambda p: p.volume_24h, reverse=True)
        
        # Deduplicate by pair_address (keep highest volume)
        seen = set()
        unique_pairs = []
        for pair in all_pairs:
            if pair.pair_address not in seen:
                seen.add(pair.pair_address)
                unique_pairs.append(pair)
        
        return unique_pairs[:limit]
    
    def get_stats(self) -> Dict[str, Any]:
        """Return runtime stats."""
        uptime = time.time() - self._start_time
        return {
            "requests": self._request_count,
            "errors": self._error_count,
            "uptime_seconds": round(uptime, 1),
            "requests_per_minute": round(self._request_count / max(uptime / 60, 1), 1),
        }
