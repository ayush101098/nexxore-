"""
Market Data Collector - Fetches OHLCV data from exchanges via CCXT
Supports: Binance, Bybit, OKX with automatic failover
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple
import ccxt.async_support as ccxt

from .base_collector import (
    BaseCollector, FetchResult, CollectorStatus
)

logger = logging.getLogger(__name__)


class MarketDataCollector(BaseCollector[Dict]):
    """
    Collects OHLCV market data from multiple exchanges via CCXT.
    
    Features:
    - Multi-exchange support with failover
    - Multiple timeframes (1m, 5m, 15m, 1h, 4h, 1d)
    - Deduplication on insert
    - Gap detection and backfill
    """
    
    SUPPORTED_EXCHANGES = ['binance', 'bybit', 'okx']
    TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d']
    
    def __init__(self, db_pool, redis_client, config: Dict[str, Any] = None):
        super().__init__(
            name='market_data',
            db_pool=db_pool,
            redis_client=redis_client,
            config=config or {}
        )
        
        self._exchanges: Dict[str, ccxt.Exchange] = {}
        self._primary_exchange = self.config.get('primary_exchange', 'binance')
        self._timeframes = self.config.get('timeframes', ['1m', '15m', '1h', '4h'])
        
    async def _get_exchange(self, exchange_id: str) -> ccxt.Exchange:
        """Get or create exchange instance"""
        if exchange_id not in self._exchanges:
            exchange_class = getattr(ccxt, exchange_id, None)
            if exchange_class is None:
                raise ValueError(f"Unsupported exchange: {exchange_id}")
            
            exchange_config = {
                'enableRateLimit': True,
                'rateLimit': 100,  # ms between requests
                'options': {
                    'defaultType': 'swap',  # For futures data
                }
            }
            
            # Add API keys if configured
            api_key = self.config.get(f'{exchange_id}_api_key')
            api_secret = self.config.get(f'{exchange_id}_api_secret')
            if api_key and api_secret:
                exchange_config['apiKey'] = api_key
                exchange_config['secret'] = api_secret
            
            self._exchanges[exchange_id] = exchange_class(exchange_config)
            await self._exchanges[exchange_id].load_markets()
            
        return self._exchanges[exchange_id]
    
    async def close(self):
        """Close all exchange connections"""
        await super().close()
        for exchange in self._exchanges.values():
            await exchange.close()
        self._exchanges.clear()
    
    async def fetch(
        self,
        symbols: List[str],
        timeframes: List[str] = None,
        since: datetime = None,
        limit: int = 500,
        **kwargs
    ) -> FetchResult:
        """
        Fetch OHLCV data for multiple symbols and timeframes
        """
        timeframes = timeframes or self._timeframes
        all_data = []
        errors = []
        
        # Default: fetch last 500 candles
        if since is None:
            since = datetime.now(timezone.utc) - timedelta(hours=24)
        
        since_ms = int(since.timestamp() * 1000)
        
        for symbol in symbols:
            for timeframe in timeframes:
                try:
                    ohlcv = await self._fetch_ohlcv_with_failover(
                        symbol, timeframe, since_ms, limit
                    )
                    
                    for candle in ohlcv:
                        all_data.append({
                            'symbol': symbol,
                            'timeframe': timeframe,
                            'exchange': self._primary_exchange,
                            'timestamp': datetime.fromtimestamp(
                                candle[0] / 1000, tz=timezone.utc
                            ),
                            'open': candle[1],
                            'high': candle[2],
                            'low': candle[3],
                            'close': candle[4],
                            'volume': candle[5],
                        })
                        
                except Exception as e:
                    errors.append(f"{symbol}/{timeframe}: {str(e)}")
                    logger.warning(f"Failed to fetch {symbol} {timeframe}: {e}")
        
        return FetchResult(
            success=len(all_data) > 0,
            data=all_data,
            records_count=len(all_data),
            error='; '.join(errors) if errors else None,
            metadata={
                'symbols': symbols,
                'timeframes': timeframes,
                'exchange': self._primary_exchange
            }
        )
    
    async def _fetch_ohlcv_with_failover(
        self,
        symbol: str,
        timeframe: str,
        since_ms: int,
        limit: int
    ) -> List[List]:
        """Fetch OHLCV with automatic exchange failover"""
        exchanges_to_try = [self._primary_exchange] + [
            e for e in self.SUPPORTED_EXCHANGES if e != self._primary_exchange
        ]
        
        last_error = None
        
        for exchange_id in exchanges_to_try:
            try:
                exchange = await self._get_exchange(exchange_id)
                
                # Check if symbol exists on exchange
                if symbol not in exchange.markets:
                    continue
                
                # Wait for rate limit
                await self.rate_limiter.wait_if_needed()
                
                ohlcv = await exchange.fetch_ohlcv(
                    symbol, timeframe, since=since_ms, limit=limit
                )
                
                if ohlcv:
                    return ohlcv
                    
            except Exception as e:
                last_error = e
                logger.debug(f"Failover from {exchange_id}: {e}")
                continue
        
        raise last_error or Exception(f"No exchange has data for {symbol}")
    
    async def validate(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Validate OHLCV data"""
        validated = []
        
        for record in data:
            try:
                # Check required fields
                if not all(k in record for k in ['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume']):
                    continue
                
                # Validate OHLC relationships
                o, h, l, c = record['open'], record['high'], record['low'], record['close']
                
                if h < l:  # High must be >= Low
                    continue
                if h < max(o, c) or l > min(o, c):  # High/Low must contain O/C
                    continue
                if record['volume'] < 0:  # Volume must be non-negative
                    continue
                
                # Check for zero/null prices
                if any(p is None or p <= 0 for p in [o, h, l, c]):
                    continue
                
                validated.append(record)
                
            except Exception as e:
                logger.debug(f"Validation failed for record: {e}")
                continue
        
        rejected_count = len(data) - len(validated)
        if rejected_count > 0:
            logger.info(f"Rejected {rejected_count} invalid records")
            
        return validated
    
    async def store(self, data: List[Dict[str, Any]]) -> int:
        """Store OHLCV data with upsert semantics"""
        if not data:
            return 0
        
        columns = [
            'symbol', 'timestamp', 'timeframe', 'exchange',
            'open', 'high', 'low', 'close', 'volume'
        ]
        
        records = [
            (
                r['symbol'],
                r['timestamp'],
                r['timeframe'],
                r.get('exchange', 'binance'),
                float(r['open']),
                float(r['high']),
                float(r['low']),
                float(r['close']),
                float(r['volume'])
            )
            for r in data
        ]
        
        on_conflict = """
            (symbol, timeframe, timestamp, exchange) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume
        """
        
        return await self._batch_insert(
            self.get_table_name(),
            columns,
            records,
            on_conflict
        )
    
    def get_table_name(self) -> str:
        return 'market_data'
    
    async def detect_gaps(
        self,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime
    ) -> List[Tuple[datetime, datetime]]:
        """Detect data gaps in stored data"""
        gaps = []
        
        # Map timeframe to expected interval
        tf_seconds = {
            '1m': 60, '5m': 300, '15m': 900,
            '1h': 3600, '4h': 14400, '1d': 86400
        }
        interval = timedelta(seconds=tf_seconds.get(timeframe, 60))
        
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT timestamp
                FROM market_data
                WHERE symbol = $1 AND timeframe = $2
                AND timestamp BETWEEN $3 AND $4
                ORDER BY timestamp
            """, symbol, timeframe, start, end)
        
        if not rows:
            return [(start, end)]
        
        timestamps = [row['timestamp'] for row in rows]
        
        # Check for gaps
        prev_ts = start
        for ts in timestamps:
            if ts - prev_ts > interval * 1.5:  # Allow 50% tolerance
                gaps.append((prev_ts, ts))
            prev_ts = ts
        
        # Check end gap
        if end - prev_ts > interval * 1.5:
            gaps.append((prev_ts, end))
        
        return gaps
    
    async def backfill(
        self,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime
    ) -> Dict[str, Any]:
        """Backfill historical data for a symbol"""
        logger.info(f"Backfilling {symbol} {timeframe} from {start} to {end}")
        
        total_fetched = 0
        total_stored = 0
        current = start
        
        while current < end:
            result = await self.fetch(
                [symbol],
                [timeframe],
                since=current,
                limit=1000
            )
            
            if result.success and result.data:
                validated = await self.validate(result.data)
                stored = await self.store(validated)
                total_fetched += len(result.data)
                total_stored += stored
                
                # Move to next batch
                last_ts = max(r['timestamp'] for r in result.data)
                current = last_ts + timedelta(seconds=1)
            else:
                break
            
            # Rate limit
            await asyncio.sleep(0.5)
        
        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'records_fetched': total_fetched,
            'records_stored': total_stored
        }
