"""
On-Chain Data Collector - Fetches blockchain metrics from Glassnode, DefiLlama, etc.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import aiohttp

from .base_collector import BaseCollector, FetchResult

logger = logging.getLogger(__name__)


class OnChainCollector(BaseCollector[Dict]):
    """
    Collects on-chain metrics:
    - Exchange flows (in/out)
    - Whale activity
    - TVL from DeFi protocols
    - Network metrics (active addresses, transactions)
    - Stablecoin supply changes
    
    Sources: DefiLlama (free), Glassnode (API key required)
    """
    
    DEFILLAMA_BASE = "https://api.llama.fi"
    GLASSNODE_BASE = "https://api.glassnode.com/v1/metrics"
    
    # Map symbols to coingecko/defillama IDs
    SYMBOL_TO_COINGECKO = {
        'BTCUSDT': 'bitcoin',
        'ETHUSDT': 'ethereum',
        'SOLUSDT': 'solana',
        'BNBUSDT': 'binancecoin',
        'AVAXUSDT': 'avalanche-2',
        'MATICUSDT': 'matic-network',
        'DOTUSDT': 'polkadot',
        'ATOMUSDT': 'cosmos',
        'LINKUSDT': 'chainlink',
        'UNIUSDT': 'uniswap',
        'AAVEUSDT': 'aave',
        'NEARUSDT': 'near',
        'APTUSDT': 'aptos',
        'ARBUSDT': 'arbitrum',
        'OPUSDT': 'optimism',
    }
    
    # Chain mappings for TVL
    SYMBOL_TO_CHAIN = {
        'ETHUSDT': 'Ethereum',
        'SOLUSDT': 'Solana', 
        'AVAXUSDT': 'Avalanche',
        'MATICUSDT': 'Polygon',
        'BNBUSDT': 'BSC',
        'ARBUSDT': 'Arbitrum',
        'OPUSDT': 'Optimism',
        'NEARUSDT': 'Near',
        'ATOMUSDT': 'Cosmos',
    }
    
    def __init__(self, db_pool, redis_client, config: Dict[str, Any] = None):
        super().__init__(
            name='onchain_data',
            db_pool=db_pool,
            redis_client=redis_client,
            config=config or {}
        )
        
        self._glassnode_api_key = self.config.get('glassnode_api_key')
    
    async def fetch(
        self,
        symbols: List[str],
        **kwargs
    ) -> FetchResult:
        """
        Fetch on-chain data from multiple sources
        """
        all_data = []
        errors = []
        
        # Fetch from different sources
        tasks = [
            self._fetch_tvl_data(symbols),
            self._fetch_stablecoin_data(),
        ]
        
        # Add Glassnode if API key available
        if self._glassnode_api_key:
            tasks.append(self._fetch_glassnode_data(symbols))
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, Exception):
                errors.append(str(result))
            elif isinstance(result, list):
                all_data.extend(result)
        
        # Merge by symbol
        merged = self._merge_onchain_data(all_data)
        
        return FetchResult(
            success=len(merged) > 0,
            data=merged,
            records_count=len(merged),
            error='; '.join(errors) if errors else None
        )
    
    async def _fetch_tvl_data(self, symbols: List[str]) -> List[Dict]:
        """Fetch TVL data from DefiLlama"""
        data = []
        
        # Get current TVL for each chain
        for symbol in symbols:
            chain = self.SYMBOL_TO_CHAIN.get(symbol)
            if not chain:
                continue
            
            try:
                url = f"{self.DEFILLAMA_BASE}/v2/historicalChainTvl/{chain}"
                await self.rate_limiter.wait_if_needed()
                response = await self._fetch_with_retry(url)
                
                if response and len(response) > 0:
                    # Get latest TVL
                    latest = response[-1]
                    prev_24h = response[-2] if len(response) > 1 else latest
                    
                    current_tvl = latest.get('tvl', 0)
                    prev_tvl = prev_24h.get('tvl', 0)
                    tvl_change = ((current_tvl - prev_tvl) / prev_tvl * 100) if prev_tvl > 0 else 0
                    
                    data.append({
                        'symbol': symbol,
                        'chain': chain.lower(),
                        'timestamp': datetime.now(timezone.utc),
                        'tvl': current_tvl,
                        'tvl_change_24h': tvl_change,
                    })
                    
            except Exception as e:
                logger.debug(f"Failed to fetch TVL for {chain}: {e}")
        
        return data
    
    async def _fetch_stablecoin_data(self) -> List[Dict]:
        """Fetch stablecoin supply data from DefiLlama"""
        data = []
        
        try:
            url = f"{self.DEFILLAMA_BASE}/stablecoins"
            await self.rate_limiter.wait_if_needed()
            response = await self._fetch_with_retry(url)
            
            if response and 'peggedAssets' in response:
                # Calculate total stablecoin supply change
                total_supply = sum(
                    asset.get('circulating', {}).get('peggedUSD', 0)
                    for asset in response['peggedAssets']
                )
                
                # Store as a metric for market analysis
                data.append({
                    'symbol': 'USDT_AGGREGATE',
                    'chain': 'all',
                    'timestamp': datetime.now(timezone.utc),
                    'circulating_supply': total_supply,
                })
                
        except Exception as e:
            logger.warning(f"Failed to fetch stablecoin data: {e}")
        
        return data
    
    async def _fetch_glassnode_data(self, symbols: List[str]) -> List[Dict]:
        """Fetch detailed on-chain metrics from Glassnode"""
        data = []
        
        # Map to Glassnode asset codes
        asset_map = {
            'BTCUSDT': 'BTC',
            'ETHUSDT': 'ETH',
            'SOLUSDT': 'SOL',
        }
        
        metrics = [
            'addresses/active_count',
            'addresses/new_non_zero_count', 
            'transactions/count',
            'transactions/transfers_volume_sum',
            'supply/current',
        ]
        
        for symbol in symbols:
            asset = asset_map.get(symbol)
            if not asset:
                continue
            
            record = {
                'symbol': symbol,
                'chain': asset.lower(),
                'timestamp': datetime.now(timezone.utc),
            }
            
            for metric in metrics:
                try:
                    url = f"{self.GLASSNODE_BASE}/{metric}"
                    params = {
                        'a': asset,
                        'api_key': self._glassnode_api_key,
                        's': int((datetime.now(timezone.utc) - timedelta(days=1)).timestamp()),
                        'i': '24h'
                    }
                    
                    await self.rate_limiter.wait_if_needed()
                    response = await self._fetch_with_retry(url, params=params)
                    
                    if response and len(response) > 0:
                        value = response[-1].get('v', 0)
                        
                        # Map metric names
                        if 'active_count' in metric:
                            record['active_addresses'] = int(value)
                        elif 'new_non_zero' in metric:
                            record['new_addresses'] = int(value)
                        elif 'transactions/count' in metric:
                            record['transaction_count'] = int(value)
                        elif 'transfers_volume' in metric:
                            record['transaction_volume'] = value
                        elif 'supply/current' in metric:
                            record['circulating_supply'] = value
                            
                except Exception as e:
                    logger.debug(f"Failed to fetch Glassnode {metric} for {asset}: {e}")
            
            if len(record) > 3:  # Has more than just symbol, chain, timestamp
                data.append(record)
        
        return data
    
    def _merge_onchain_data(self, data: List[Dict]) -> List[Dict]:
        """Merge on-chain data by symbol/chain/timestamp"""
        merged = {}
        
        for record in data:
            symbol = record.get('symbol')
            chain = record.get('chain', 'unknown')
            ts = record.get('timestamp')
            
            if not symbol or not ts:
                continue
            
            ts_rounded = ts.replace(minute=0, second=0, microsecond=0)
            key = (symbol, chain, ts_rounded)
            
            if key not in merged:
                merged[key] = {
                    'symbol': symbol,
                    'chain': chain,
                    'timestamp': ts_rounded
                }
            
            # Merge all fields
            for field, value in record.items():
                if field not in ['symbol', 'chain', 'timestamp'] and value is not None:
                    merged[key][field] = value
        
        return list(merged.values())
    
    async def validate(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Validate on-chain data"""
        validated = []
        
        for record in data:
            if not record.get('symbol') or not record.get('timestamp'):
                continue
            
            # TVL must be non-negative
            if 'tvl' in record and record['tvl'] < 0:
                continue
            
            # Address counts must be non-negative
            for field in ['active_addresses', 'new_addresses', 'transaction_count']:
                if field in record and record[field] < 0:
                    record[field] = 0
            
            validated.append(record)
        
        return validated
    
    async def store(self, data: List[Dict[str, Any]]) -> int:
        """Store on-chain data"""
        if not data:
            return 0
        
        columns = [
            'symbol', 'chain', 'timestamp',
            'tvl', 'tvl_change_24h',
            'active_addresses', 'new_addresses',
            'transaction_count', 'transaction_volume',
            'circulating_supply', 'stablecoin_supply_change',
            'exchange_netflow', 'exchange_inflow', 'exchange_outflow',
            'whale_netflow', 'whale_transactions_count'
        ]
        
        records = []
        for r in data:
            records.append((
                r['symbol'],
                r.get('chain', 'unknown'),
                r['timestamp'],
                r.get('tvl'),
                r.get('tvl_change_24h'),
                r.get('active_addresses'),
                r.get('new_addresses'),
                r.get('transaction_count'),
                r.get('transaction_volume'),
                r.get('circulating_supply'),
                r.get('stablecoin_supply_change'),
                r.get('exchange_netflow'),
                r.get('exchange_inflow'),
                r.get('exchange_outflow'),
                r.get('whale_netflow'),
                r.get('whale_transactions_count')
            ))
        
        on_conflict = """
            (symbol, chain, timestamp) DO UPDATE SET
            tvl = COALESCE(EXCLUDED.tvl, onchain_data.tvl),
            tvl_change_24h = COALESCE(EXCLUDED.tvl_change_24h, onchain_data.tvl_change_24h),
            active_addresses = COALESCE(EXCLUDED.active_addresses, onchain_data.active_addresses),
            new_addresses = COALESCE(EXCLUDED.new_addresses, onchain_data.new_addresses),
            transaction_count = COALESCE(EXCLUDED.transaction_count, onchain_data.transaction_count),
            transaction_volume = COALESCE(EXCLUDED.transaction_volume, onchain_data.transaction_volume),
            circulating_supply = COALESCE(EXCLUDED.circulating_supply, onchain_data.circulating_supply)
        """
        
        return await self._batch_insert(
            self.get_table_name(),
            columns,
            records,
            on_conflict
        )
    
    def get_table_name(self) -> str:
        return 'onchain_data'
