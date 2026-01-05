"""
Research Bot - Main orchestrator and entry point
"""

import asyncio
import logging
import os
import signal
import sys
from datetime import datetime, timezone
from typing import Dict, List

import asyncpg
import redis.asyncio as aioredis

# Import components
from collectors import (
    MarketDataCollector,
    DerivativesCollector,
    OnChainCollector,
    SocialCollector,
    NewsCollector,
    collector_registry
)
from features import FeatureEngineer
from models import ModelRegistry, EnsemblePredictor, DirectionModel, BreakoutModel, VolatilityModel
from signals import SignalGenerator

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/app/logs/research_bot.log')
    ]
)
logger = logging.getLogger(__name__)


class ResearchBot:
    """
    Main orchestrator for the crypto research bot.
    Coordinates data collection, feature engineering, ML predictions, and signal generation.
    """
    
    def __init__(self, config: Dict = None):
        self.config = config or {}
        
        # Database and cache
        self.db_pool: asyncpg.Pool = None
        self.redis: aioredis.Redis = None
        
        # Components
        self.collectors: Dict = {}
        self.feature_engineer: FeatureEngineer = None
        self.model_registry: ModelRegistry = None
        self.ensemble_predictor: EnsemblePredictor = None
        self.signal_generator: SignalGenerator = None
        
        # State
        self._running = False
        self._symbols: List[str] = []
        
        # Collection intervals (in seconds)
        self.intervals = {
            'market_data': 60,      # 1 minute
            'derivatives': 300,     # 5 minutes
            'onchain': 3600,        # 1 hour
            'social': 1800,         # 30 minutes
            'news': 900,            # 15 minutes
            'features': 300,        # 5 minutes
            'signals': 300,         # 5 minutes
        }
    
    async def initialize(self):
        """Initialize all components"""
        logger.info("Initializing Research Bot...")
        
        # Create database pool
        self.db_pool = await asyncpg.create_pool(
            host=os.getenv('DB_HOST', 'localhost'),
            port=int(os.getenv('DB_PORT', 5432)),
            user=os.getenv('DB_USER', 'research_bot'),
            password=os.getenv('DB_PASSWORD', 'research_bot_password'),
            database=os.getenv('DB_NAME', 'research_bot'),
            min_size=5,
            max_size=20
        )
        logger.info("Database pool created")
        
        # Connect to Redis
        self.redis = aioredis.from_url(
            os.getenv('REDIS_URL', 'redis://localhost:6379'),
            encoding='utf-8',
            decode_responses=False
        )
        await self.redis.ping()
        logger.info("Redis connected")
        
        # Load symbol universe
        await self._load_symbols()
        
        # Initialize collectors
        self._init_collectors()
        
        # Initialize feature engineer
        self.feature_engineer = FeatureEngineer(
            self.db_pool,
            self.redis,
            config=self.config.get('features', {})
        )
        
        # Initialize model registry
        self.model_registry = ModelRegistry(
            self.db_pool,
            models_dir=self.config.get('models_dir', '/app/models')
        )
        
        # Initialize ensemble predictor
        self.ensemble_predictor = EnsemblePredictor(self.model_registry)
        
        # Initialize signal generator
        self.signal_generator = SignalGenerator(
            self.db_pool,
            self.feature_engineer,
            self.ensemble_predictor,
            config=self.config.get('signals', {})
        )
        
        # Load or train models
        await self._init_models()
        
        logger.info("Research Bot initialized successfully")
    
    async def _load_symbols(self):
        """Load active symbols from database"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT symbol FROM symbol_universe
                WHERE is_active = true
            """)
        
        self._symbols = [row['symbol'] for row in rows]
        logger.info(f"Loaded {len(self._symbols)} symbols")
    
    def _init_collectors(self):
        """Initialize all data collectors"""
        collector_config = {
            'binance_api_key': os.getenv('BINANCE_API_KEY'),
            'binance_api_secret': os.getenv('BINANCE_API_SECRET'),
            'coinglass_api_key': os.getenv('COINGLASS_API_KEY'),
            'glassnode_api_key': os.getenv('GLASSNODE_API_KEY'),
            'twitter_bearer_token': os.getenv('TWITTER_BEARER_TOKEN'),
            'cryptopanic_api_key': os.getenv('CRYPTOPANIC_API_KEY'),
        }
        
        # Market data collector
        self.collectors['market_data'] = MarketDataCollector(
            self.db_pool, self.redis, collector_config
        )
        collector_registry.register(self.collectors['market_data'])
        
        # Derivatives collector
        self.collectors['derivatives'] = DerivativesCollector(
            self.db_pool, self.redis, collector_config
        )
        collector_registry.register(self.collectors['derivatives'])
        
        # On-chain collector
        self.collectors['onchain'] = OnChainCollector(
            self.db_pool, self.redis, collector_config
        )
        collector_registry.register(self.collectors['onchain'])
        
        # Social collector
        self.collectors['social'] = SocialCollector(
            self.db_pool, self.redis, collector_config
        )
        collector_registry.register(self.collectors['social'])
        
        # News collector
        self.collectors['news'] = NewsCollector(
            self.db_pool, self.redis, collector_config
        )
        collector_registry.register(self.collectors['news'])
        
        logger.info(f"Initialized {len(self.collectors)} collectors")
    
    async def _init_models(self):
        """Initialize or load ML models"""
        # Check if models exist
        direction_model = await self.model_registry.get_model('direction_model')
        
        if direction_model is None:
            logger.info("No trained models found, initializing new models...")
            
            # Create new models (they will be trained when enough data is collected)
            direction_model = DirectionModel(config={'horizon': 4, 'threshold': 0.5})
            breakout_model = BreakoutModel(config={'horizon': 12, 'breakout_threshold': 2.0})
            volatility_model = VolatilityModel(config={'horizon': 24})
            
            # Note: Models will be trained during the training cycle
            logger.info("Models initialized (not trained yet)")
        else:
            logger.info("Loaded existing trained models")
    
    async def run(self):
        """Main run loop"""
        self._running = True
        
        # Create tasks for each component
        tasks = [
            asyncio.create_task(self._run_collector_loop('market_data')),
            asyncio.create_task(self._run_collector_loop('derivatives')),
            asyncio.create_task(self._run_collector_loop('onchain')),
            asyncio.create_task(self._run_collector_loop('social')),
            asyncio.create_task(self._run_collector_loop('news')),
            asyncio.create_task(self._run_feature_loop()),
            asyncio.create_task(self._run_signal_loop()),
            asyncio.create_task(self._run_health_check_loop()),
        ]
        
        logger.info("Research Bot running...")
        
        try:
            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            logger.info("Tasks cancelled")
    
    async def _run_collector_loop(self, collector_name: str):
        """Run a collector in a loop"""
        collector = self.collectors.get(collector_name)
        if not collector:
            return
        
        interval = self.intervals.get(collector_name, 60)
        
        while self._running:
            try:
                logger.info(f"Running {collector_name} collection...")
                result = await collector.collect(self._symbols)
                
                if result['success']:
                    logger.info(
                        f"{collector_name}: Collected {result['records_stored']} records"
                    )
                else:
                    logger.warning(f"{collector_name}: Collection failed - {result.get('error')}")
                    
            except Exception as e:
                logger.error(f"{collector_name} error: {e}", exc_info=True)
            
            await asyncio.sleep(interval)
    
    async def _run_feature_loop(self):
        """Run feature engineering loop"""
        interval = self.intervals.get('features', 300)
        
        while self._running:
            try:
                logger.info("Computing features...")
                
                for symbol in self._symbols[:10]:  # Process top 10 first
                    try:
                        feature_set = await self.feature_engineer.compute_features(
                            symbol, timeframe='1h'
                        )
                        
                        if feature_set.features:
                            await self.feature_engineer.store_features(feature_set)
                            
                    except Exception as e:
                        logger.debug(f"Feature computation failed for {symbol}: {e}")
                
                logger.info(f"Features computed for {min(10, len(self._symbols))} symbols")
                
            except Exception as e:
                logger.error(f"Feature loop error: {e}", exc_info=True)
            
            await asyncio.sleep(interval)
    
    async def _run_signal_loop(self):
        """Run signal generation loop"""
        interval = self.intervals.get('signals', 300)
        
        while self._running:
            try:
                logger.info("Generating trade setups...")
                
                new_setups = 0
                for symbol in self._symbols[:20]:  # Top 20 symbols
                    try:
                        setup = await self.signal_generator.generate_setup(
                            symbol, timeframe='1h'
                        )
                        
                        if setup:
                            setup_id = await self.signal_generator.save_setup(setup)
                            new_setups += 1
                            logger.info(
                                f"New {setup.direction} setup for {symbol}: "
                                f"confidence={setup.confidence_score:.2f}"
                            )
                            
                    except Exception as e:
                        logger.debug(f"Setup generation failed for {symbol}: {e}")
                
                # Validate existing setups
                active_setups = await self.signal_generator.get_active_setups()
                for setup in active_setups:
                    is_valid, reason = await self.signal_generator.check_setup_validity(setup)
                    if not is_valid:
                        await self.signal_generator.update_setup_status(
                            setup.id,
                            'INVALIDATED',
                            reason
                        )
                        logger.info(f"Invalidated setup {setup.id}: {reason}")
                
                logger.info(f"Generated {new_setups} new setups")
                
            except Exception as e:
                logger.error(f"Signal loop error: {e}", exc_info=True)
            
            await asyncio.sleep(interval)
    
    async def _run_health_check_loop(self):
        """Run periodic health checks"""
        while self._running:
            try:
                health = collector_registry.get_health()
                
                for name, status in health.items():
                    if status.status.value == 'error':
                        logger.warning(f"Collector {name} in error state: {status.last_error_message}")
                
                # Log summary
                logger.info(
                    f"Health check: {len(health)} collectors, "
                    f"{sum(1 for h in health.values() if h.status.value == 'idle')} idle"
                )
                
            except Exception as e:
                logger.error(f"Health check error: {e}")
            
            await asyncio.sleep(60)
    
    async def shutdown(self):
        """Graceful shutdown"""
        logger.info("Shutting down Research Bot...")
        self._running = False
        
        # Close collectors
        await collector_registry.close_all()
        
        # Close connections
        if self.db_pool:
            await self.db_pool.close()
        if self.redis:
            await self.redis.close()
        
        logger.info("Research Bot shutdown complete")


async def main():
    """Main entry point"""
    bot = ResearchBot()
    
    # Signal handlers
    loop = asyncio.get_event_loop()
    
    def signal_handler():
        asyncio.create_task(bot.shutdown())
    
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)
    
    try:
        await bot.initialize()
        await bot.run()
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
    finally:
        await bot.shutdown()


if __name__ == "__main__":
    # Create logs directory
    os.makedirs('/app/logs', exist_ok=True)
    
    asyncio.run(main())
