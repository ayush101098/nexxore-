"""
Derivatives Data Collector - Fetches funding rates, open interest, liquidations
Sources: Binance Futures, Bybit, Coinglass API
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import aiohttp

from .base_collector import BaseCollector, FetchResult

logger = logging.getLogger(__name__)


class DerivativesCollector(BaseCollector[Dict]):
    """
    Collects derivatives data:
    - Funding rates
    - Open interest
    - Long/Short ratios
    - Liquidations
    - Mark/Index prices
    
    Sources: Exchange APIs + Coinglass
    """
    
    COINGLASS_BASE = "https://open-api.coinglass.com/public/v2"
    BINANCE_FUTURES_BASE = "https://fapi.binance.com/fapi/v1"
    
    def __init__(self, db_pool, redis_client, config: Dict[str, Any] = None):
        super().__init__(
            name='derivatives_data',
            db_pool=db_pool,
            redis_client=redis_client,
            config=config or {}
        )
        
        self._coinglass_api_key = self.config.get('coinglass_api_key')
        
    def _get_default_headers(self) -> Dict[str, str]:
        headers = super()._get_default_headers()
        if self._coinglass_api_key:
            headers['coinglassSecret'] = self._coinglass_api_key
        return headers
    
    async def fetch(
        self,
        symbols: List[str],
        **kwargs
    ) -> FetchResult:
        """
        Fetch derivatives data from multiple sources
        """
        all_data = []
        errors = []
        
        # Fetch from different sources concurrently
        tasks = [
            self._fetch_funding_rates(symbols),
            self._fetch_open_interest(symbols),
            self._fetch_long_short_ratio(symbols),
            self._fetch_liquidations(symbols),
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, Exception):
                errors.append(str(result))
            elif isinstance(result, list):
                all_data.extend(result)
        
        # Merge data by symbol and timestamp
        merged_data = self._merge_derivatives_data(all_data)
        
        return FetchResult(
            success=len(merged_data) > 0,
            data=merged_data,
            records_count=len(merged_data),
            error='; '.join(errors) if errors else None
        )
    
    async def _fetch_funding_rates(self, symbols: List[str]) -> List[Dict]:
        """Fetch current and historical funding rates"""
        data = []
        
        try:
            # Binance funding rates
            url = f"{self.BINANCE_FUTURES_BASE}/premiumIndex"
            response = await self._fetch_with_retry(url)
            
            symbol_set = set(symbols)
            
            for item in response:
                binance_symbol = item.get('symbol', '')
                # Convert Binance symbol format
                if binance_symbol in symbol_set or binance_symbol.replace('USDT', '') + 'USDT' in symbol_set:
                    data.append({
                        'symbol': binance_symbol,
                        'timestamp': datetime.now(timezone.utc),
                        'exchange': 'binance',
                        'funding_rate': float(item.get('lastFundingRate', 0)),
                        'mark_price': float(item.get('markPrice', 0)),
                        'index_price': float(item.get('indexPrice', 0)),
                    })
                    
        except Exception as e:
            logger.warning(f"Failed to fetch funding rates: {e}")
        
        return data
    
    async def _fetch_open_interest(self, symbols: List[str]) -> List[Dict]:
        """Fetch open interest from Binance Futures"""
        data = []
        
        for symbol in symbols:
            try:
                url = f"{self.BINANCE_FUTURES_BASE}/openInterest"
                params = {'symbol': symbol}
                
                await self.rate_limiter.wait_if_needed()
                response = await self._fetch_with_retry(url, params=params)
                
                if response:
                    data.append({
                        'symbol': symbol,
                        'timestamp': datetime.now(timezone.utc),
                        'exchange': 'binance',
                        'open_interest': float(response.get('openInterest', 0)),
                    })
                    
            except Exception as e:
                logger.debug(f"Failed to fetch OI for {symbol}: {e}")
        
        return data
    
    async def _fetch_long_short_ratio(self, symbols: List[str]) -> List[Dict]:
        """Fetch global long/short ratio"""
        data = []
        
        for symbol in symbols:
            try:
                # Top trader long/short ratio
                url = f"{self.BINANCE_FUTURES_BASE}/topLongShortPositionRatio"
                params = {'symbol': symbol, 'period': '1h', 'limit': 1}
                
                await self.rate_limiter.wait_if_needed()
                response = await self._fetch_with_retry(url, params=params)
                
                if response and len(response) > 0:
                    item = response[0]
                    data.append({
                        'symbol': symbol,
                        'timestamp': datetime.fromtimestamp(
                            item.get('timestamp', 0) / 1000, tz=timezone.utc
                        ),
                        'exchange': 'binance',
                        'long_short_ratio': float(item.get('longShortRatio', 1)),
                        'top_trader_long_short_ratio': float(item.get('longShortRatio', 1)),
                    })
                    
            except Exception as e:
                logger.debug(f"Failed to fetch LS ratio for {symbol}: {e}")
        
        return data
    
    async def _fetch_liquidations(self, symbols: List[str]) -> List[Dict]:
        """Fetch recent liquidations (aggregated)"""
        data = []
        
        # Use Coinglass if API key available
        if self._coinglass_api_key:
            try:
                url = f"{self.COINGLASS_BASE}/liquidation/info"
                response = await self._fetch_with_retry(url)
                
                if response.get('code') == '0' and response.get('data'):
                    symbol_set = set(s.replace('USDT', '') for s in symbols)
                    
                    for item in response['data']:
                        coin = item.get('symbol', '')
                        if coin in symbol_set:
                            data.append({
                                'symbol': f"{coin}USDT",
                                'timestamp': datetime.now(timezone.utc),
                                'exchange': 'aggregate',
                                'liquidation_volume_long': float(item.get('longLiquidationUsd', 0)),
                                'liquidation_volume_short': float(item.get('shortLiquidationUsd', 0)),
                            })
                            
            except Exception as e:
                logger.warning(f"Failed to fetch liquidations from Coinglass: {e}")
        
        return data
    
    def _merge_derivatives_data(self, data: List[Dict]) -> List[Dict]:
        """Merge data from different sources by symbol/exchange/timestamp"""
        merged = {}
        
        for record in data:
            symbol = record.get('symbol')
            exchange = record.get('exchange', 'binance')
            ts = record.get('timestamp')
            
            if not symbol or not ts:
                continue
            
            # Round timestamp to minute for merging
            ts_rounded = ts.replace(second=0, microsecond=0)
            key = (symbol, exchange, ts_rounded)
            
            if key not in merged:
                merged[key] = {
                    'symbol': symbol,
                    'exchange': exchange,
                    'timestamp': ts_rounded
                }
            
            # Merge fields
            for field in [
                'funding_rate', 'open_interest', 'open_interest_value',
                'long_short_ratio', 'top_trader_long_short_ratio',
                'liquidation_volume_long', 'liquidation_volume_short',
                'mark_price', 'index_price'
            ]:
                if field in record and record[field] is not None:
                    merged[key][field] = record[field]
        
        return list(merged.values())
    
    async def validate(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Validate derivatives data"""
        validated = []
        
        for record in data:
            try:
                # Must have symbol and timestamp
                if not record.get('symbol') or not record.get('timestamp'):
                    continue
                
                # Validate funding rate range (-100% to 100%)
                if 'funding_rate' in record:
                    fr = record['funding_rate']
                    if fr < -1 or fr > 1:
                        record['funding_rate'] = max(-1, min(1, fr))
                
                # Open interest must be non-negative
                if 'open_interest' in record and record['open_interest'] < 0:
                    continue
                
                validated.append(record)
                
            except Exception as e:
                logger.debug(f"Validation failed: {e}")
                continue
        
        return validated
    
    async def store(self, data: List[Dict[str, Any]]) -> int:
        """Store derivatives data"""
        if not data:
            return 0
        
        columns = [
            'symbol', 'timestamp', 'exchange',
            'funding_rate', 'open_interest', 'open_interest_value',
            'long_short_ratio', 'top_trader_long_short_ratio',
            'liquidation_volume_long', 'liquidation_volume_short',
            'mark_price', 'index_price'
        ]
        
        records = [
            (
                r['symbol'],
                r['timestamp'],
                r.get('exchange', 'binance'),
                r.get('funding_rate'),
                r.get('open_interest'),
                r.get('open_interest_value'),
                r.get('long_short_ratio'),
                r.get('top_trader_long_short_ratio'),
                r.get('liquidation_volume_long'),
                r.get('liquidation_volume_short'),
                r.get('mark_price'),
                r.get('index_price')
            )
            for r in data
        ]
        
        on_conflict = """
            (symbol, timestamp, exchange) DO UPDATE SET
            funding_rate = COALESCE(EXCLUDED.funding_rate, derivatives_data.funding_rate),
            open_interest = COALESCE(EXCLUDED.open_interest, derivatives_data.open_interest),
            open_interest_value = COALESCE(EXCLUDED.open_interest_value, derivatives_data.open_interest_value),
            long_short_ratio = COALESCE(EXCLUDED.long_short_ratio, derivatives_data.long_short_ratio),
            top_trader_long_short_ratio = COALESCE(EXCLUDED.top_trader_long_short_ratio, derivatives_data.top_trader_long_short_ratio),
            liquidation_volume_long = COALESCE(EXCLUDED.liquidation_volume_long, derivatives_data.liquidation_volume_long),
            liquidation_volume_short = COALESCE(EXCLUDED.liquidation_volume_short, derivatives_data.liquidation_volume_short),
            mark_price = COALESCE(EXCLUDED.mark_price, derivatives_data.mark_price),
            index_price = COALESCE(EXCLUDED.index_price, derivatives_data.index_price)
        """
        
        return await self._batch_insert(
            self.get_table_name(),
            columns,
            records,
            on_conflict
        )
    
    def get_table_name(self) -> str:
        return 'derivatives_data'


class CoinglassCollector(BaseCollector[Dict]):
    """
    Specialized collector for Coinglass API data:
    - Global OI aggregates
    - Exchange-level OI breakdown
    - Liquidation heatmaps
    - Fear & Greed Index
    """
    
    BASE_URL = "https://open-api.coinglass.com/public/v2"
    
    def __init__(self, db_pool, redis_client, config: Dict[str, Any] = None):
        super().__init__(
            name='coinglass',
            db_pool=db_pool,
            redis_client=redis_client,
            config=config or {}
        )
        
        self._api_key = self.config.get('coinglass_api_key', '')
        
    def _get_default_headers(self) -> Dict[str, str]:
        return {
            'User-Agent': 'ResearchBot/1.0',
            'Accept': 'application/json',
            'coinglassSecret': self._api_key
        }
    
    async def fetch_oi_history(
        self,
        symbol: str,
        interval: str = '1h',
        limit: int = 100
    ) -> List[Dict]:
        """Fetch historical open interest"""
        url = f"{self.BASE_URL}/open_interest/history"
        params = {
            'symbol': symbol.replace('USDT', ''),
            'interval': interval,
            'limit': limit
        }
        
        try:
            response = await self._fetch_with_retry(url, params=params)
            
            if response.get('code') == '0' and response.get('data'):
                return [
                    {
                        'symbol': f"{symbol}",
                        'timestamp': datetime.fromtimestamp(
                            item['createTime'] / 1000, tz=timezone.utc
                        ),
                        'open_interest_value': item.get('openInterest', 0),
                    }
                    for item in response['data']
                ]
        except Exception as e:
            logger.warning(f"Failed to fetch OI history: {e}")
        
        return []
    
    async def fetch_funding_rate_history(
        self,
        symbol: str,
        limit: int = 100
    ) -> List[Dict]:
        """Fetch historical funding rates across exchanges"""
        url = f"{self.BASE_URL}/funding"
        params = {
            'symbol': symbol.replace('USDT', ''),
            'limit': limit
        }
        
        try:
            response = await self._fetch_with_retry(url, params=params)
            
            if response.get('code') == '0' and response.get('data'):
                return response['data']
        except Exception as e:
            logger.warning(f"Failed to fetch funding history: {e}")
        
        return []
    
    async def fetch(self, symbols: List[str], **kwargs) -> FetchResult:
        """Fetch aggregated derivatives data from Coinglass"""
        # Delegate to DerivativesCollector
        pass
    
    async def validate(self, data: List[Dict]) -> List[Dict]:
        return data
    
    async def store(self, data: List[Dict]) -> int:
        return 0
    
    def get_table_name(self) -> str:
        return 'derivatives_data'
