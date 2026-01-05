"""
Feature Engineering Engine - Computes ML-ready features from raw market data
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum

import numpy as np
import pandas as pd
from scipy import stats

logger = logging.getLogger(__name__)


class MarketRegime(str, Enum):
    """Market regime states"""
    TRENDING_UP = "trending_up"
    TRENDING_DOWN = "trending_down"
    RANGING = "ranging"
    HIGH_VOLATILITY = "high_volatility"
    LOW_VOLATILITY = "low_volatility"
    BREAKOUT = "breakout"
    BREAKDOWN = "breakdown"


@dataclass
class FeatureSet:
    """Container for computed features"""
    symbol: str
    timestamp: datetime
    timeframe: str
    features: Dict[str, float]
    regime: Optional[MarketRegime] = None


class PriceFeatureCalculator:
    """
    Calculates price-based features:
    - Returns at multiple horizons
    - Volatility measures
    - Trend indicators
    - Range analysis
    """
    
    @staticmethod
    def calculate_returns(
        close: pd.Series,
        periods: List[int] = [1, 5, 15, 60, 240, 1440]
    ) -> Dict[str, float]:
        """Calculate returns at multiple horizons"""
        features = {}
        
        for period in periods:
            if len(close) > period:
                ret = (close.iloc[-1] / close.iloc[-period - 1] - 1) * 100
                features[f'return_{period}'] = ret
            else:
                features[f'return_{period}'] = 0.0
        
        return features
    
    @staticmethod
    def calculate_volatility(
        close: pd.Series,
        high: pd.Series,
        low: pd.Series,
        windows: List[int] = [20, 50, 100]
    ) -> Dict[str, float]:
        """Calculate volatility measures"""
        features = {}
        
        # Log returns for volatility
        log_returns = np.log(close / close.shift(1)).dropna()
        
        for window in windows:
            if len(log_returns) >= window:
                # Standard deviation of returns (annualized)
                std = log_returns.tail(window).std() * np.sqrt(365 * 24)
                features[f'volatility_{window}'] = std
                
                # Parkinson volatility (using high-low)
                if len(high) >= window and len(low) >= window:
                    hl_ratio = np.log(high.tail(window) / low.tail(window))
                    parkinson = np.sqrt(
                        (1 / (4 * np.log(2))) * (hl_ratio ** 2).mean()
                    ) * np.sqrt(365 * 24)
                    features[f'parkinson_vol_{window}'] = parkinson
        
        # ATR-based volatility
        if len(close) >= 14:
            tr = pd.concat([
                high - low,
                abs(high - close.shift(1)),
                abs(low - close.shift(1))
            ], axis=1).max(axis=1)
            atr = tr.rolling(14).mean().iloc[-1]
            features['atr_14'] = atr / close.iloc[-1] * 100  # As percentage
        
        return features
    
    @staticmethod
    def calculate_trend(
        close: pd.Series,
        windows: List[int] = [7, 21, 50, 200]
    ) -> Dict[str, float]:
        """Calculate trend indicators"""
        features = {}
        
        # Moving averages
        for window in windows:
            if len(close) >= window:
                ma = close.rolling(window).mean().iloc[-1]
                features[f'ma_{window}'] = ma
                features[f'price_vs_ma_{window}'] = (close.iloc[-1] / ma - 1) * 100
        
        # EMA
        for window in [12, 26, 50]:
            if len(close) >= window:
                ema = close.ewm(span=window).mean().iloc[-1]
                features[f'ema_{window}'] = ema
        
        # MACD
        if len(close) >= 26:
            ema12 = close.ewm(span=12).mean()
            ema26 = close.ewm(span=26).mean()
            macd = ema12 - ema26
            signal = macd.ewm(span=9).mean()
            
            features['macd'] = macd.iloc[-1]
            features['macd_signal'] = signal.iloc[-1]
            features['macd_histogram'] = (macd - signal).iloc[-1]
        
        # ADX (simplified)
        if len(close) >= 14:
            # Calculate directional movement
            high_diff = close.diff()
            low_diff = -close.diff()
            
            plus_dm = high_diff.where(high_diff > low_diff, 0).where(high_diff > 0, 0)
            minus_dm = low_diff.where(low_diff > high_diff, 0).where(low_diff > 0, 0)
            
            tr = close.diff().abs()
            
            plus_di = 100 * (plus_dm.rolling(14).mean() / tr.rolling(14).mean())
            minus_di = 100 * (minus_dm.rolling(14).mean() / tr.rolling(14).mean())
            
            dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
            adx = dx.rolling(14).mean().iloc[-1]
            
            features['adx'] = adx if not np.isnan(adx) else 25
            features['plus_di'] = plus_di.iloc[-1] if not np.isnan(plus_di.iloc[-1]) else 50
            features['minus_di'] = minus_di.iloc[-1] if not np.isnan(minus_di.iloc[-1]) else 50
        
        return features
    
    @staticmethod
    def calculate_range_features(
        high: pd.Series,
        low: pd.Series,
        close: pd.Series,
        windows: List[int] = [20, 50, 100]
    ) -> Dict[str, float]:
        """Calculate range-based features"""
        features = {}
        
        for window in windows:
            if len(high) >= window:
                period_high = high.tail(window).max()
                period_low = low.tail(window).min()
                
                # Position within range
                range_position = (close.iloc[-1] - period_low) / (period_high - period_low)
                features[f'range_position_{window}'] = range_position
                
                # Range width as % of price
                range_width = (period_high - period_low) / close.iloc[-1] * 100
                features[f'range_width_{window}'] = range_width
                
                # Distance from high/low
                features[f'dist_from_high_{window}'] = (period_high - close.iloc[-1]) / close.iloc[-1] * 100
                features[f'dist_from_low_{window}'] = (close.iloc[-1] - period_low) / close.iloc[-1] * 100
        
        return features


class MomentumFeatureCalculator:
    """
    Calculates momentum indicators:
    - RSI
    - Stochastic
    - CCI
    - Williams %R
    """
    
    @staticmethod
    def calculate_rsi(close: pd.Series, periods: List[int] = [14, 7, 21]) -> Dict[str, float]:
        """Calculate RSI at multiple periods"""
        features = {}
        
        for period in periods:
            if len(close) > period:
                delta = close.diff()
                gain = delta.where(delta > 0, 0)
                loss = -delta.where(delta < 0, 0)
                
                avg_gain = gain.rolling(period).mean()
                avg_loss = loss.rolling(period).mean()
                
                rs = avg_gain / avg_loss
                rsi = 100 - (100 / (1 + rs))
                
                features[f'rsi_{period}'] = rsi.iloc[-1]
        
        return features
    
    @staticmethod
    def calculate_stochastic(
        high: pd.Series,
        low: pd.Series,
        close: pd.Series,
        k_period: int = 14,
        d_period: int = 3
    ) -> Dict[str, float]:
        """Calculate Stochastic Oscillator"""
        features = {}
        
        if len(close) >= k_period:
            lowest_low = low.rolling(k_period).min()
            highest_high = high.rolling(k_period).max()
            
            k = 100 * (close - lowest_low) / (highest_high - lowest_low)
            d = k.rolling(d_period).mean()
            
            features['stoch_k'] = k.iloc[-1]
            features['stoch_d'] = d.iloc[-1]
            features['stoch_diff'] = k.iloc[-1] - d.iloc[-1]
        
        return features
    
    @staticmethod
    def calculate_cci(
        high: pd.Series,
        low: pd.Series,
        close: pd.Series,
        period: int = 20
    ) -> Dict[str, float]:
        """Calculate Commodity Channel Index"""
        features = {}
        
        if len(close) >= period:
            typical_price = (high + low + close) / 3
            sma = typical_price.rolling(period).mean()
            mad = typical_price.rolling(period).apply(
                lambda x: np.mean(np.abs(x - x.mean()))
            )
            
            cci = (typical_price - sma) / (0.015 * mad)
            features['cci'] = cci.iloc[-1]
        
        return features
    
    @staticmethod
    def calculate_williams_r(
        high: pd.Series,
        low: pd.Series,
        close: pd.Series,
        period: int = 14
    ) -> Dict[str, float]:
        """Calculate Williams %R"""
        features = {}
        
        if len(close) >= period:
            highest_high = high.rolling(period).max()
            lowest_low = low.rolling(period).min()
            
            wr = -100 * (highest_high - close) / (highest_high - lowest_low)
            features['williams_r'] = wr.iloc[-1]
        
        return features


class VolumeFeatureCalculator:
    """
    Calculates volume-based features:
    - Volume trends
    - OBV
    - Volume profile
    - Relative volume
    """
    
    @staticmethod
    def calculate_volume_features(
        close: pd.Series,
        volume: pd.Series,
        windows: List[int] = [10, 20, 50]
    ) -> Dict[str, float]:
        """Calculate volume-based features"""
        features = {}
        
        # Volume moving averages
        for window in windows:
            if len(volume) >= window:
                vol_ma = volume.rolling(window).mean().iloc[-1]
                features[f'volume_ma_{window}'] = vol_ma
                features[f'volume_vs_ma_{window}'] = volume.iloc[-1] / vol_ma if vol_ma > 0 else 1
        
        # OBV (On-Balance Volume)
        if len(close) > 1:
            obv = (np.sign(close.diff()) * volume).cumsum()
            features['obv'] = obv.iloc[-1]
            
            if len(obv) >= 20:
                obv_trend = (obv.iloc[-1] - obv.iloc[-20]) / abs(obv.iloc[-20]) if obv.iloc[-20] != 0 else 0
                features['obv_trend'] = obv_trend
        
        # Volume momentum
        if len(volume) >= 5:
            vol_change = (volume.iloc[-1] / volume.tail(5).mean() - 1) * 100
            features['volume_change_5'] = vol_change
        
        # Price-volume correlation
        if len(close) >= 20:
            pv_corr = close.tail(20).corr(volume.tail(20))
            features['price_volume_corr'] = pv_corr if not np.isnan(pv_corr) else 0
        
        return features


class RegimeDetector:
    """
    Detects market regime using multiple methods:
    - Volatility-based classification
    - Trend strength analysis
    - HMM-based regime detection (optional)
    """
    
    def __init__(self, use_hmm: bool = True):
        self.use_hmm = use_hmm
        self._hmm_model = None
        
    def detect_regime(
        self,
        close: pd.Series,
        high: pd.Series,
        low: pd.Series,
        volume: pd.Series
    ) -> MarketRegime:
        """Detect current market regime"""
        if len(close) < 50:
            return MarketRegime.RANGING
        
        # Calculate indicators
        returns = close.pct_change().dropna()
        
        # Volatility regime
        current_vol = returns.tail(20).std() * np.sqrt(365 * 24)
        historical_vol = returns.tail(100).std() * np.sqrt(365 * 24)
        vol_ratio = current_vol / historical_vol if historical_vol > 0 else 1
        
        # Trend regime
        ma20 = close.rolling(20).mean().iloc[-1]
        ma50 = close.rolling(50).mean().iloc[-1]
        price = close.iloc[-1]
        
        # ADX for trend strength
        adx_features = PriceFeatureCalculator.calculate_trend(close)
        adx = adx_features.get('adx', 25)
        
        # Range analysis
        range_features = PriceFeatureCalculator.calculate_range_features(high, low, close)
        range_pos = range_features.get('range_position_20', 0.5)
        
        # Decision logic
        if vol_ratio > 1.5:
            return MarketRegime.HIGH_VOLATILITY
        elif vol_ratio < 0.5:
            return MarketRegime.LOW_VOLATILITY
        elif adx > 40 and price > ma20 > ma50:
            return MarketRegime.TRENDING_UP
        elif adx > 40 and price < ma20 < ma50:
            return MarketRegime.TRENDING_DOWN
        elif range_pos > 0.95 and vol_ratio > 1.2:
            return MarketRegime.BREAKOUT
        elif range_pos < 0.05 and vol_ratio > 1.2:
            return MarketRegime.BREAKDOWN
        else:
            return MarketRegime.RANGING
    
    def detect_regime_hmm(
        self,
        close: pd.Series,
        n_states: int = 3
    ) -> Tuple[MarketRegime, Dict[str, float]]:
        """
        Use Hidden Markov Model for regime detection
        Returns regime and state probabilities
        """
        try:
            from hmmlearn import hmm
        except ImportError:
            logger.warning("hmmlearn not available, using rule-based detection")
            return self.detect_regime(close, close, close, close), {}
        
        if len(close) < 100:
            return MarketRegime.RANGING, {}
        
        # Prepare features for HMM
        returns = close.pct_change().dropna().values.reshape(-1, 1)
        volatility = pd.Series(returns.flatten()).rolling(10).std().dropna().values.reshape(-1, 1)
        
        # Combine features
        min_len = min(len(returns), len(volatility))
        features = np.hstack([returns[-min_len:], volatility])
        
        # Train HMM
        if self._hmm_model is None:
            self._hmm_model = hmm.GaussianHMM(
                n_components=n_states,
                covariance_type="diag",
                n_iter=100
            )
            self._hmm_model.fit(features)
        
        # Get current state
        _, states = self._hmm_model.decode(features)
        current_state = states[-1]
        
        # Get state probabilities
        state_probs = self._hmm_model.predict_proba(features)[-1]
        
        # Map state to regime (based on mean returns of each state)
        state_means = self._hmm_model.means_[:, 0]
        state_volatilities = np.sqrt(self._hmm_model.covars_[:, 0, 0])
        
        # Order states by mean return
        ordered_states = np.argsort(state_means)
        
        if current_state == ordered_states[0]:
            regime = MarketRegime.TRENDING_DOWN
        elif current_state == ordered_states[-1]:
            regime = MarketRegime.TRENDING_UP
        else:
            regime = MarketRegime.RANGING
        
        probs = {
            f'state_{i}_prob': state_probs[i]
            for i in range(n_states)
        }
        
        return regime, probs


class OrderFlowFeatureCalculator:
    """
    Calculates order flow features from derivatives data:
    - Funding rate analysis
    - Open interest changes
    - Long/short ratio
    - Liquidation impact
    """
    
    @staticmethod
    def calculate_funding_features(
        funding_rates: pd.Series,
        windows: List[int] = [8, 24, 72]  # In terms of 8-hour funding periods
    ) -> Dict[str, float]:
        """Calculate funding rate features"""
        features = {}
        
        if len(funding_rates) > 0:
            features['funding_current'] = funding_rates.iloc[-1]
            
            for window in windows:
                if len(funding_rates) >= window:
                    # Average funding
                    features[f'funding_avg_{window}'] = funding_rates.tail(window).mean()
                    
                    # Funding trend
                    if window >= 3:
                        early = funding_rates.iloc[-window:-window//2].mean()
                        late = funding_rates.iloc[-window//2:].mean()
                        features[f'funding_trend_{window}'] = late - early
        
        return features
    
    @staticmethod
    def calculate_oi_features(
        open_interest: pd.Series,
        price: pd.Series,
        windows: List[int] = [24, 72, 168]
    ) -> Dict[str, float]:
        """Calculate open interest features"""
        features = {}
        
        if len(open_interest) > 0 and len(price) > 0:
            # Current OI
            features['oi_current'] = open_interest.iloc[-1]
            
            for window in windows:
                if len(open_interest) >= window:
                    # OI change
                    oi_change = (open_interest.iloc[-1] / open_interest.iloc[-window] - 1) * 100
                    features[f'oi_change_{window}'] = oi_change
                    
                    # OI vs price divergence
                    price_change = (price.iloc[-1] / price.iloc[-window] - 1) * 100
                    features[f'oi_price_divergence_{window}'] = oi_change - price_change
        
        return features
    
    @staticmethod
    def calculate_ls_ratio_features(
        ls_ratio: pd.Series
    ) -> Dict[str, float]:
        """Calculate long/short ratio features"""
        features = {}
        
        if len(ls_ratio) > 0:
            features['ls_ratio_current'] = ls_ratio.iloc[-1]
            
            # Extreme levels
            features['ls_ratio_is_extreme_long'] = float(ls_ratio.iloc[-1] > 2.0)
            features['ls_ratio_is_extreme_short'] = float(ls_ratio.iloc[-1] < 0.5)
            
            if len(ls_ratio) >= 24:
                # Trend
                features['ls_ratio_trend'] = ls_ratio.iloc[-1] - ls_ratio.iloc[-24]
                
                # Position in historical range
                ls_percentile = stats.percentileofscore(ls_ratio.tail(168), ls_ratio.iloc[-1])
                features['ls_ratio_percentile'] = ls_percentile
        
        return features


class CrossAssetFeatureCalculator:
    """
    Calculates cross-asset features:
    - BTC correlation
    - Sector correlation
    - Relative strength
    - Beta calculation
    """
    
    @staticmethod
    def calculate_correlation_features(
        asset_returns: pd.Series,
        btc_returns: pd.Series,
        sector_returns: Dict[str, pd.Series] = None,
        windows: List[int] = [20, 50, 100]
    ) -> Dict[str, float]:
        """Calculate correlation features"""
        features = {}
        
        for window in windows:
            if len(asset_returns) >= window and len(btc_returns) >= window:
                # BTC correlation
                corr = asset_returns.tail(window).corr(btc_returns.tail(window))
                features[f'btc_correlation_{window}'] = corr if not np.isnan(corr) else 0
                
                # Beta to BTC
                if btc_returns.tail(window).var() > 0:
                    cov = asset_returns.tail(window).cov(btc_returns.tail(window))
                    var = btc_returns.tail(window).var()
                    beta = cov / var
                    features[f'btc_beta_{window}'] = beta
        
        # Sector correlations if provided
        if sector_returns:
            for sector_name, sector_ret in sector_returns.items():
                if len(asset_returns) >= 20 and len(sector_ret) >= 20:
                    corr = asset_returns.tail(20).corr(sector_ret.tail(20))
                    features[f'{sector_name}_correlation'] = corr if not np.isnan(corr) else 0
        
        return features
    
    @staticmethod
    def calculate_relative_strength(
        asset_returns: pd.Series,
        benchmark_returns: pd.Series,
        window: int = 20
    ) -> Dict[str, float]:
        """Calculate relative strength vs benchmark"""
        features = {}
        
        if len(asset_returns) >= window and len(benchmark_returns) >= window:
            # Relative performance
            asset_cum_return = (1 + asset_returns.tail(window)).prod() - 1
            bench_cum_return = (1 + benchmark_returns.tail(window)).prod() - 1
            
            features['relative_strength'] = (asset_cum_return - bench_cum_return) * 100
            
            # Rolling relative strength
            asset_rolling = (1 + asset_returns).cumprod()
            bench_rolling = (1 + benchmark_returns).cumprod()
            
            rs_ratio = asset_rolling / bench_rolling
            features['rs_ratio'] = rs_ratio.iloc[-1]
            
            # RS momentum
            if len(rs_ratio) >= 5:
                features['rs_momentum'] = (rs_ratio.iloc[-1] / rs_ratio.iloc[-5] - 1) * 100
        
        return features


class FeatureEngineer:
    """
    Main feature engineering class that orchestrates all calculators
    """
    
    def __init__(self, db_pool, redis_client, config: Dict = None):
        self.db_pool = db_pool
        self.redis = redis_client
        self.config = config or {}
        
        # Initialize calculators
        self.price_calc = PriceFeatureCalculator()
        self.momentum_calc = MomentumFeatureCalculator()
        self.volume_calc = VolumeFeatureCalculator()
        self.regime_detector = RegimeDetector(use_hmm=self.config.get('use_hmm', True))
        self.orderflow_calc = OrderFlowFeatureCalculator()
        self.cross_asset_calc = CrossAssetFeatureCalculator()
    
    async def compute_features(
        self,
        symbol: str,
        timeframe: str = '1h',
        lookback_periods: int = 500
    ) -> FeatureSet:
        """
        Compute all features for a symbol
        """
        # Fetch market data
        ohlcv = await self._fetch_ohlcv(symbol, timeframe, lookback_periods)
        
        if ohlcv is None or len(ohlcv) < 50:
            logger.warning(f"Insufficient data for {symbol}")
            return FeatureSet(
                symbol=symbol,
                timestamp=datetime.now(timezone.utc),
                timeframe=timeframe,
                features={}
            )
        
        close = ohlcv['close']
        high = ohlcv['high']
        low = ohlcv['low']
        volume = ohlcv['volume']
        
        # Calculate all features
        features = {}
        
        # Price features
        features.update(self.price_calc.calculate_returns(close))
        features.update(self.price_calc.calculate_volatility(close, high, low))
        features.update(self.price_calc.calculate_trend(close))
        features.update(self.price_calc.calculate_range_features(high, low, close))
        
        # Momentum features
        features.update(self.momentum_calc.calculate_rsi(close))
        features.update(self.momentum_calc.calculate_stochastic(high, low, close))
        features.update(self.momentum_calc.calculate_cci(high, low, close))
        features.update(self.momentum_calc.calculate_williams_r(high, low, close))
        
        # Volume features
        features.update(self.volume_calc.calculate_volume_features(close, volume))
        
        # Regime detection
        regime = self.regime_detector.detect_regime(close, high, low, volume)
        features['regime'] = regime.value
        
        # Fetch and compute derivatives features if available
        derivatives = await self._fetch_derivatives(symbol)
        if derivatives is not None and len(derivatives) > 0:
            if 'funding_rate' in derivatives.columns:
                features.update(
                    self.orderflow_calc.calculate_funding_features(derivatives['funding_rate'])
                )
            if 'open_interest' in derivatives.columns:
                features.update(
                    self.orderflow_calc.calculate_oi_features(derivatives['open_interest'], close)
                )
            if 'long_short_ratio' in derivatives.columns:
                features.update(
                    self.orderflow_calc.calculate_ls_ratio_features(derivatives['long_short_ratio'])
                )
        
        # Cross-asset features (BTC correlation)
        if symbol != 'BTCUSDT':
            btc_ohlcv = await self._fetch_ohlcv('BTCUSDT', timeframe, lookback_periods)
            if btc_ohlcv is not None and len(btc_ohlcv) > 0:
                asset_returns = close.pct_change().dropna()
                btc_returns = btc_ohlcv['close'].pct_change().dropna()
                
                features.update(
                    self.cross_asset_calc.calculate_correlation_features(
                        asset_returns, btc_returns
                    )
                )
                features.update(
                    self.cross_asset_calc.calculate_relative_strength(
                        asset_returns, btc_returns
                    )
                )
        
        return FeatureSet(
            symbol=symbol,
            timestamp=datetime.now(timezone.utc),
            timeframe=timeframe,
            features=features,
            regime=regime
        )
    
    async def _fetch_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        limit: int
    ) -> Optional[pd.DataFrame]:
        """Fetch OHLCV data from database"""
        try:
            async with self.db_pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT timestamp, open, high, low, close, volume
                    FROM market_data
                    WHERE symbol = $1 AND timeframe = $2
                    ORDER BY timestamp DESC
                    LIMIT $3
                """, symbol, timeframe, limit)
            
            if not rows:
                return None
            
            df = pd.DataFrame([dict(r) for r in rows])
            df = df.sort_values('timestamp')
            df.set_index('timestamp', inplace=True)
            
            return df
            
        except Exception as e:
            logger.error(f"Failed to fetch OHLCV for {symbol}: {e}")
            return None
    
    async def _fetch_derivatives(
        self,
        symbol: str,
        limit: int = 100
    ) -> Optional[pd.DataFrame]:
        """Fetch derivatives data from database"""
        try:
            async with self.db_pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT timestamp, funding_rate, open_interest, 
                           long_short_ratio, liquidation_volume_long,
                           liquidation_volume_short
                    FROM derivatives_data
                    WHERE symbol = $1
                    ORDER BY timestamp DESC
                    LIMIT $2
                """, symbol, limit)
            
            if not rows:
                return None
            
            df = pd.DataFrame([dict(r) for r in rows])
            df = df.sort_values('timestamp')
            df.set_index('timestamp', inplace=True)
            
            return df
            
        except Exception as e:
            logger.debug(f"No derivatives data for {symbol}: {e}")
            return None
    
    async def store_features(self, feature_set: FeatureSet):
        """Store computed features to database"""
        try:
            async with self.db_pool.acquire() as conn:
                # Store each feature
                for feature_name, feature_value in feature_set.features.items():
                    if feature_value is not None and not np.isnan(feature_value):
                        # Determine feature set category
                        if any(x in feature_name for x in ['return', 'volatility', 'trend', 'range', 'ma_', 'ema_']):
                            feature_category = 'price'
                        elif any(x in feature_name for x in ['rsi', 'stoch', 'cci', 'williams', 'macd', 'adx']):
                            feature_category = 'indicator'
                        elif any(x in feature_name for x in ['volume', 'obv']):
                            feature_category = 'volume'
                        elif any(x in feature_name for x in ['funding', 'oi_', 'ls_ratio']):
                            feature_category = 'orderflow'
                        elif any(x in feature_name for x in ['correlation', 'beta', 'relative']):
                            feature_category = 'cross_asset'
                        else:
                            feature_category = 'other'
                        
                        await conn.execute("""
                            INSERT INTO feature_store 
                            (symbol, timestamp, timeframe, feature_set, feature_name, feature_value)
                            VALUES ($1, $2, $3, $4, $5, $6)
                            ON CONFLICT (symbol, timeframe, timestamp, feature_set, feature_name) 
                            DO UPDATE SET feature_value = EXCLUDED.feature_value
                        """, feature_set.symbol, feature_set.timestamp, feature_set.timeframe,
                            feature_category, feature_name, float(feature_value))
                
                logger.debug(f"Stored {len(feature_set.features)} features for {feature_set.symbol}")
                
        except Exception as e:
            logger.error(f"Failed to store features: {e}")
    
    async def get_feature_vector(
        self,
        symbol: str,
        timeframe: str = '1h',
        feature_names: List[str] = None
    ) -> Dict[str, float]:
        """Get latest feature vector for ML model input"""
        try:
            async with self.db_pool.acquire() as conn:
                query = """
                    SELECT feature_name, feature_value
                    FROM feature_store
                    WHERE symbol = $1 AND timeframe = $2
                    AND timestamp = (
                        SELECT MAX(timestamp) 
                        FROM feature_store 
                        WHERE symbol = $1 AND timeframe = $2
                    )
                """
                
                if feature_names:
                    query += " AND feature_name = ANY($3)"
                    rows = await conn.fetch(query, symbol, timeframe, feature_names)
                else:
                    rows = await conn.fetch(query, symbol, timeframe)
                
                return {row['feature_name']: row['feature_value'] for row in rows}
                
        except Exception as e:
            logger.error(f"Failed to get feature vector: {e}")
            return {}
