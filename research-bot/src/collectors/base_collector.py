"""
Base Collector - Abstract base class for all data collectors
Implements common patterns: retry logic, rate limiting, validation, health monitoring
"""

import asyncio
import logging
import time
import ssl
import certifi
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, TypeVar, Generic
from dataclasses import dataclass, field
from enum import Enum
import json

import aiohttp
import redis.asyncio as aioredis
import asyncpg
from pydantic import BaseModel, validator

logger = logging.getLogger(__name__)


class CollectorStatus(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    ERROR = "error"
    RATE_LIMITED = "rate_limited"
    STOPPED = "stopped"


@dataclass
class CollectorHealth:
    """Health status for a collector"""
    name: str
    status: CollectorStatus
    last_success: Optional[datetime] = None
    last_error: Optional[datetime] = None
    last_error_message: Optional[str] = None
    records_fetched: int = 0
    records_stored: int = 0
    errors_count: int = 0
    avg_fetch_time_ms: float = 0
    uptime_pct: float = 100.0
    

@dataclass
class FetchResult:
    """Result from a fetch operation"""
    success: bool
    data: List[Dict[str, Any]] = field(default_factory=list)
    records_count: int = 0
    fetch_time_ms: int = 0
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class RateLimiter:
    """Token bucket rate limiter with Redis backend"""
    
    def __init__(
        self, 
        redis_client: aioredis.Redis,
        key_prefix: str,
        requests_per_minute: int = 60,
        requests_per_second: int = 5
    ):
        self.redis = redis_client
        self.key_prefix = key_prefix
        self.rpm = requests_per_minute
        self.rps = requests_per_second
        
    async def acquire(self, weight: int = 1) -> bool:
        """Try to acquire rate limit tokens"""
        now = time.time()
        second_key = f"{self.key_prefix}:sec:{int(now)}"
        minute_key = f"{self.key_prefix}:min:{int(now/60)}"
        
        pipe = self.redis.pipeline()
        
        # Check second limit
        pipe.incr(second_key)
        pipe.expire(second_key, 2)
        
        # Check minute limit  
        pipe.incr(minute_key)
        pipe.expire(minute_key, 120)
        
        results = await pipe.execute()
        second_count, _, minute_count, _ = results
        
        if second_count > self.rps or minute_count > self.rpm:
            logger.warning(f"Rate limit exceeded: {second_count}/s, {minute_count}/m")
            return False
        return True
    
    async def wait_if_needed(self, weight: int = 1) -> None:
        """Wait until rate limit allows"""
        while not await self.acquire(weight):
            await asyncio.sleep(0.1)


class RetryConfig:
    """Configuration for retry behavior"""
    def __init__(
        self,
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 60.0,
        exponential_base: float = 2.0,
        jitter: bool = True
    ):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base
        self.jitter = jitter
    
    def get_delay(self, attempt: int) -> float:
        """Calculate delay for given attempt"""
        delay = min(
            self.base_delay * (self.exponential_base ** attempt),
            self.max_delay
        )
        if self.jitter:
            import random
            delay *= (0.5 + random.random())
        return delay


T = TypeVar('T')

class BaseCollector(ABC, Generic[T]):
    """
    Abstract base class for all data collectors.
    
    Provides:
    - Async HTTP client with connection pooling
    - Redis-based rate limiting
    - PostgreSQL batch inserts
    - Retry logic with exponential backoff
    - Health monitoring
    - Data validation
    """
    
    def __init__(
        self,
        name: str,
        db_pool: asyncpg.Pool,
        redis_client: aioredis.Redis,
        config: Dict[str, Any] = None
    ):
        self.name = name
        self.db_pool = db_pool
        self.redis = redis_client
        self.config = config or {}
        
        # HTTP session
        self._session: Optional[aiohttp.ClientSession] = None
        
        # Rate limiting
        self.rate_limiter = RateLimiter(
            redis_client,
            key_prefix=f"ratelimit:{name}",
            requests_per_minute=self.config.get('rpm', 120),
            requests_per_second=self.config.get('rps', 10)
        )
        
        # Retry config
        self.retry_config = RetryConfig(
            max_retries=self.config.get('max_retries', 3),
            base_delay=self.config.get('retry_base_delay', 1.0),
            max_delay=self.config.get('retry_max_delay', 60.0)
        )
        
        # Health tracking
        self._health = CollectorHealth(name=name, status=CollectorStatus.IDLE)
        self._fetch_times: List[float] = []
        self._running = False
        
    @property
    def session(self) -> aiohttp.ClientSession:
        """Get or create HTTP session with proper SSL handling"""
        if self._session is None or self._session.closed:
            # Create SSL context with certifi certificates for macOS compatibility
            ssl_context = ssl.create_default_context(cafile=certifi.where())
            connector = aiohttp.TCPConnector(ssl=ssl_context)
            
            timeout = aiohttp.ClientTimeout(total=30, connect=10)
            self._session = aiohttp.ClientSession(
                timeout=timeout,
                connector=connector,
                headers=self._get_default_headers()
            )
        return self._session
    
    def _get_default_headers(self) -> Dict[str, str]:
        """Override for custom headers"""
        return {
            'User-Agent': 'ResearchBot/1.0',
            'Accept': 'application/json'
        }
    
    async def close(self):
        """Cleanup resources"""
        self._running = False
        if self._session and not self._session.closed:
            await self._session.close()
    
    @abstractmethod
    async def fetch(self, symbols: List[str], **kwargs) -> FetchResult:
        """
        Fetch data from source. Must be implemented by subclass.
        
        Args:
            symbols: List of symbols to fetch
            **kwargs: Additional parameters
            
        Returns:
            FetchResult with fetched data
        """
        pass
    
    @abstractmethod
    async def validate(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Validate fetched data. Must be implemented by subclass.
        
        Args:
            data: Raw data from fetch
            
        Returns:
            List of validated records
        """
        pass
    
    @abstractmethod
    async def store(self, data: List[Dict[str, Any]]) -> int:
        """
        Store data to database. Must be implemented by subclass.
        
        Args:
            data: Validated data to store
            
        Returns:
            Number of records stored
        """
        pass
    
    @abstractmethod
    def get_table_name(self) -> str:
        """Return the target table name"""
        pass
    
    async def _fetch_with_retry(
        self, 
        url: str,
        method: str = 'GET',
        **kwargs
    ) -> Dict[str, Any]:
        """
        Fetch URL with retry logic and rate limiting
        """
        last_error = None
        
        for attempt in range(self.retry_config.max_retries + 1):
            try:
                # Wait for rate limit
                await self.rate_limiter.wait_if_needed()
                
                async with self.session.request(method, url, **kwargs) as response:
                    if response.status == 429:
                        # Rate limited by API
                        self._health.status = CollectorStatus.RATE_LIMITED
                        retry_after = int(response.headers.get('Retry-After', 60))
                        logger.warning(f"{self.name}: Rate limited, waiting {retry_after}s")
                        await asyncio.sleep(retry_after)
                        continue
                    
                    response.raise_for_status()
                    return await response.json()
                    
            except aiohttp.ClientError as e:
                last_error = e
                logger.warning(
                    f"{self.name}: Request failed (attempt {attempt + 1}): {e}"
                )
                
                if attempt < self.retry_config.max_retries:
                    delay = self.retry_config.get_delay(attempt)
                    await asyncio.sleep(delay)
            except Exception as e:
                last_error = e
                logger.error(f"{self.name}: Unexpected error: {e}")
                break
        
        raise last_error or Exception("Max retries exceeded")
    
    async def _batch_insert(
        self,
        table: str,
        columns: List[str],
        records: List[tuple],
        on_conflict: str = "DO NOTHING"
    ) -> int:
        """
        Efficient batch insert using COPY or multi-value INSERT
        """
        if not records:
            return 0
            
        # Build INSERT statement
        placeholders = ', '.join(
            f'({", ".join(f"${i + j * len(columns) + 1}" for i in range(1, len(columns) + 1))})'
            for j in range(len(records))
        )
        
        # Flatten records
        values = [val for record in records for val in record]
        
        # For smaller batches, use INSERT
        if len(records) <= 1000:
            columns_str = ', '.join(columns)
            
            # Build individual placeholders
            rows = []
            for i, record in enumerate(records):
                row_placeholders = ', '.join(
                    f'${j + 1 + i * len(columns)}' 
                    for j in range(len(columns))
                )
                rows.append(f'({row_placeholders})')
            
            query = f"""
                INSERT INTO {table} ({columns_str})
                VALUES {', '.join(rows)}
                ON CONFLICT {on_conflict}
            """
            
            try:
                async with self.db_pool.acquire() as conn:
                    result = await conn.execute(query, *values)
                    # Parse INSERT result
                    count = int(result.split()[-1]) if result else len(records)
                    return count
            except Exception as e:
                logger.error(f"{self.name}: Batch insert failed: {e}")
                raise
        else:
            # For larger batches, use chunked inserts
            chunk_size = 1000
            total_inserted = 0
            
            for i in range(0, len(records), chunk_size):
                chunk = records[i:i + chunk_size]
                total_inserted += await self._batch_insert(
                    table, columns, chunk, on_conflict
                )
            
            return total_inserted
    
    async def collect(self, symbols: List[str], **kwargs) -> Dict[str, Any]:
        """
        Main collection pipeline: fetch -> validate -> store
        
        Returns dict with collection stats
        """
        self._health.status = CollectorStatus.RUNNING
        start_time = time.time()
        
        try:
            # Fetch data
            fetch_result = await self.fetch(symbols, **kwargs)
            
            if not fetch_result.success:
                self._health.status = CollectorStatus.ERROR
                self._health.last_error = datetime.now(timezone.utc)
                self._health.last_error_message = fetch_result.error
                self._health.errors_count += 1
                
                return {
                    'success': False,
                    'error': fetch_result.error,
                    'records_fetched': 0,
                    'records_stored': 0
                }
            
            # Validate data
            validated_data = await self.validate(fetch_result.data)
            
            # Store data
            stored_count = await self.store(validated_data)
            
            # Update health
            fetch_time = (time.time() - start_time) * 1000
            self._fetch_times.append(fetch_time)
            if len(self._fetch_times) > 100:
                self._fetch_times = self._fetch_times[-100:]
            
            self._health.status = CollectorStatus.IDLE
            self._health.last_success = datetime.now(timezone.utc)
            self._health.records_fetched += len(fetch_result.data)
            self._health.records_stored += stored_count
            self._health.avg_fetch_time_ms = sum(self._fetch_times) / len(self._fetch_times)
            
            # Log quality metrics
            await self._log_quality(
                records_fetched=len(fetch_result.data),
                records_stored=stored_count,
                records_rejected=len(fetch_result.data) - len(validated_data),
                fetch_duration_ms=int(fetch_time),
                status='success'
            )
            
            return {
                'success': True,
                'records_fetched': len(fetch_result.data),
                'records_validated': len(validated_data),
                'records_stored': stored_count,
                'fetch_time_ms': fetch_time,
                'metadata': fetch_result.metadata
            }
            
        except Exception as e:
            self._health.status = CollectorStatus.ERROR
            self._health.last_error = datetime.now(timezone.utc)
            self._health.last_error_message = str(e)
            self._health.errors_count += 1
            
            logger.error(f"{self.name}: Collection failed: {e}", exc_info=True)
            
            await self._log_quality(
                records_fetched=0,
                records_stored=0,
                status='failed',
                error_message=str(e)
            )
            
            return {
                'success': False,
                'error': str(e),
                'records_fetched': 0,
                'records_stored': 0
            }
    
    async def _log_quality(
        self,
        records_fetched: int,
        records_stored: int,
        records_rejected: int = 0,
        fetch_duration_ms: int = 0,
        status: str = 'success',
        error_message: str = None
    ):
        """Log data quality metrics to database"""
        try:
            async with self.db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO data_quality_logs 
                    (source, records_fetched, records_stored, records_rejected,
                     fetch_duration_ms, status, error_message)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                """, self.name, records_fetched, records_stored, records_rejected,
                    fetch_duration_ms, status, error_message)
        except Exception as e:
            logger.warning(f"Failed to log quality metrics: {e}")
    
    def get_health(self) -> CollectorHealth:
        """Get current health status"""
        return self._health
    
    async def run_continuous(
        self, 
        symbols: List[str],
        interval_seconds: int = 60,
        **kwargs
    ):
        """
        Run collector continuously with given interval
        """
        self._running = True
        logger.info(f"{self.name}: Starting continuous collection every {interval_seconds}s")
        
        while self._running:
            try:
                result = await self.collect(symbols, **kwargs)
                logger.info(
                    f"{self.name}: Collected {result.get('records_stored', 0)} records"
                )
            except Exception as e:
                logger.error(f"{self.name}: Continuous collection error: {e}")
            
            await asyncio.sleep(interval_seconds)
        
        logger.info(f"{self.name}: Stopped continuous collection")
    
    def stop(self):
        """Stop continuous collection"""
        self._running = False


class CollectorRegistry:
    """Registry for managing multiple collectors"""
    
    def __init__(self):
        self._collectors: Dict[str, BaseCollector] = {}
        
    def register(self, collector: BaseCollector):
        """Register a collector"""
        self._collectors[collector.name] = collector
        logger.info(f"Registered collector: {collector.name}")
        
    def get(self, name: str) -> Optional[BaseCollector]:
        """Get collector by name"""
        return self._collectors.get(name)
    
    def get_all(self) -> List[BaseCollector]:
        """Get all registered collectors"""
        return list(self._collectors.values())
    
    def get_health(self) -> Dict[str, CollectorHealth]:
        """Get health status for all collectors"""
        return {
            name: collector.get_health()
            for name, collector in self._collectors.items()
        }
    
    async def close_all(self):
        """Close all collectors"""
        for collector in self._collectors.values():
            await collector.close()


# Global registry
collector_registry = CollectorRegistry()
