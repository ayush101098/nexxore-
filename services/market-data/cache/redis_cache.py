"""
Nexxore Market Data - Redis Cache Layer
========================================
Tiered caching with per-data-type TTLs. Falls back to in-memory 
LRU cache when Redis is unavailable.
"""

import asyncio
import hashlib
import json
import logging
import time
from collections import OrderedDict
from typing import Any, Callable, Optional

from ..config import config

logger = logging.getLogger("nexxore.market-data.cache")


class InMemoryCache:
    """Simple LRU in-memory cache fallback."""
    
    def __init__(self, max_size: int = 2000):
        self._store: OrderedDict = OrderedDict()
        self._ttls: dict = {}
        self.max_size = max_size
        self._lock = asyncio.Lock()
    
    async def get(self, key: str) -> Optional[Any]:
        async with self._lock:
            if key in self._store:
                if time.time() < self._ttls.get(key, 0):
                    self._store.move_to_end(key)
                    return self._store[key]
                else:
                    del self._store[key]
                    self._ttls.pop(key, None)
            return None
    
    async def set(self, key: str, value: Any, ttl: int = 60):
        async with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
            self._store[key] = value
            self._ttls[key] = time.time() + ttl
            
            # Evict oldest if over capacity
            while len(self._store) > self.max_size:
                oldest_key, _ = self._store.popitem(last=False)
                self._ttls.pop(oldest_key, None)
    
    async def delete(self, key: str):
        async with self._lock:
            self._store.pop(key, None)
            self._ttls.pop(key, None)
    
    async def flush(self):
        async with self._lock:
            self._store.clear()
            self._ttls.clear()
    
    def stats(self) -> dict:
        valid = sum(1 for k in self._store if time.time() < self._ttls.get(k, 0))
        return {"size": len(self._store), "valid": valid, "max_size": self.max_size}


class RedisCache:
    """Redis-backed cache with auto-fallback to in-memory."""
    
    def __init__(self):
        self.prefix = config.cache.prefix
        self._redis = None
        self._fallback = InMemoryCache()
        self._use_redis = config.cache.enabled
        self._connected = False
    
    async def connect(self):
        """Initialize Redis connection."""
        if not self._use_redis:
            logger.info("Cache: Redis disabled, using in-memory fallback")
            return
        
        try:
            import redis.asyncio as aioredis
            self._redis = aioredis.from_url(
                config.cache.redis_url,
                decode_responses=True,
                socket_timeout=5,
            )
            await self._redis.ping()
            self._connected = True
            logger.info(f"Cache: Connected to Redis at {config.cache.redis_url}")
        except ImportError:
            logger.warning("Cache: redis package not installed, using in-memory fallback")
            self._use_redis = False
        except Exception as e:
            logger.warning(f"Cache: Redis unavailable ({e}), using in-memory fallback")
            self._use_redis = False
    
    async def close(self):
        """Close Redis connection."""
        if self._redis:
            await self._redis.close()
    
    def _key(self, key: str) -> str:
        """Build namespaced cache key."""
        return f"{self.prefix}{key}"
    
    async def get(self, key: str) -> Optional[Any]:
        """Get value from cache."""
        full_key = self._key(key)
        
        if self._connected and self._redis:
            try:
                data = await self._redis.get(full_key)
                if data:
                    return json.loads(data)
                return None
            except Exception as e:
                logger.debug(f"Redis get failed for {key}: {e}")
        
        return await self._fallback.get(full_key)
    
    async def set(self, key: str, value: Any, ttl: int = 60):
        """Set value in cache with TTL."""
        full_key = self._key(key)
        serialized = json.dumps(value, default=str)
        
        if self._connected and self._redis:
            try:
                await self._redis.setex(full_key, ttl, serialized)
                return
            except Exception as e:
                logger.debug(f"Redis set failed for {key}: {e}")
        
        await self._fallback.set(full_key, value, ttl)
    
    async def delete(self, key: str):
        """Delete key from cache."""
        full_key = self._key(key)
        
        if self._connected and self._redis:
            try:
                await self._redis.delete(full_key)
                return
            except Exception:
                pass
        
        await self._fallback.delete(full_key)
    
    async def flush_prefix(self, prefix: str = ""):
        """Flush all keys matching prefix."""
        target = self._key(prefix)
        
        if self._connected and self._redis:
            try:
                cursor = 0
                while True:
                    cursor, keys = await self._redis.scan(cursor, match=f"{target}*", count=100)
                    if keys:
                        await self._redis.delete(*keys)
                    if cursor == 0:
                        break
                return
            except Exception:
                pass
        
        await self._fallback.flush()
    
    def stats(self) -> dict:
        """Cache stats."""
        return {
            "backend": "redis" if self._connected else "in-memory",
            "connected": self._connected,
            "fallback_stats": self._fallback.stats(),
        }


class CachedMarketData:
    """High-level caching wrapper with per-data-type TTLs.
    
    Provides cache-aside pattern: check cache -> fetch if miss -> store in cache.
    """
    
    def __init__(self, cache: RedisCache):
        self.cache = cache
        self.cfg = config.cache
    
    def _hash_key(self, *parts: str) -> str:
        """Build a deterministic cache key from parts."""
        raw = ":".join(str(p) for p in parts)
        return hashlib.md5(raw.encode()).hexdigest()[:12]
    
    async def get_or_fetch(
        self,
        category: str,
        key_parts: tuple,
        fetcher: Callable,
        ttl: Optional[int] = None,
    ) -> Any:
        """Cache-aside: return cached value or call fetcher and cache result."""
        cache_key = f"{category}:{self._hash_key(*[str(p) for p in key_parts])}"
        
        # Determine TTL by category
        if ttl is None:
            ttl = {
                "top_movers": self.cfg.ttl_top_movers,
                "pair": self.cfg.ttl_pair_info,
                "token_pairs": self.cfg.ttl_token_pairs,
                "search": self.cfg.ttl_search,
                "boosts": self.cfg.ttl_boosts,
                "profiles": self.cfg.ttl_profiles,
            }.get(category, 30)
        
        # Check cache
        cached = await self.cache.get(cache_key)
        if cached is not None:
            return cached
        
        # Fetch fresh data
        result = await fetcher()
        
        # Serialize PairData objects for cache storage
        if result is not None:
            cache_value = result
            if isinstance(result, list) and result and hasattr(result[0], "to_dict"):
                cache_value = [item.to_dict() for item in result]
            elif hasattr(result, "to_dict"):
                cache_value = result.to_dict()
            
            await self.cache.set(cache_key, cache_value, ttl)
        
        return result
    
    async def invalidate(self, category: str, key_parts: tuple):
        """Invalidate a specific cache entry."""
        cache_key = f"{category}:{self._hash_key(*[str(p) for p in key_parts])}"
        await self.cache.delete(cache_key)


# Global cache instance
cache = RedisCache()
cached_data = CachedMarketData(cache)
