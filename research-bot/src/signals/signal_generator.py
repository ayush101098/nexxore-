"""
Signal Generator - Generates trade setups from ML predictions and features
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
import json

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class SetupType(str, Enum):
    BREAKOUT = "breakout"
    BREAKDOWN = "breakdown"
    MEAN_REVERSION = "mean_reversion"
    TREND_CONTINUATION = "trend_continuation"
    MOMENTUM = "momentum"
    REVERSAL = "reversal"


class SetupStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INVALIDATED = "INVALIDATED"
    ENTRY_HIT = "ENTRY_HIT"
    TARGET_1_HIT = "TARGET_1_HIT"
    TARGET_2_HIT = "TARGET_2_HIT"
    STOPPED_OUT = "STOPPED_OUT"


@dataclass
class TradeSetup:
    """Trade setup with entry/exit levels and supporting analysis"""
    symbol: str
    direction: str  # LONG or SHORT
    timeframe: str
    setup_type: SetupType
    
    # Price levels
    current_price: float
    entry_min: float
    entry_max: float
    invalidation: float  # Stop loss
    target_1: Optional[float] = None
    target_2: Optional[float] = None
    target_max: Optional[float] = None
    
    # Scoring
    confidence_score: float = 0.0
    risk_reward_ratio: float = 0.0
    quality_score: float = 0.0
    
    # Context
    regime: Optional[str] = None
    market_condition: Optional[str] = None
    
    # Supporting data
    supporting_factors: Dict[str, Any] = field(default_factory=dict)
    risk_factors: Dict[str, Any] = field(default_factory=dict)
    model_predictions: Dict[str, Any] = field(default_factory=dict)
    feature_snapshot: Dict[str, float] = field(default_factory=dict)
    
    # Metadata
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    status: SetupStatus = SetupStatus.ACTIVE
    id: Optional[int] = None


class SignalGenerator:
    """
    Generates trade setups by combining:
    - ML model predictions
    - Technical features
    - Market regime
    - Risk management rules
    """
    
    # Minimum thresholds for setup generation
    MIN_CONFIDENCE = 0.55
    MIN_RR_RATIO = 1.5
    
    # Setup-specific parameters
    SETUP_CONFIGS = {
        SetupType.BREAKOUT: {
            'entry_buffer_pct': 0.2,
            'stop_buffer_pct': 1.5,
            'target_1_rr': 1.5,
            'target_2_rr': 3.0,
        },
        SetupType.TREND_CONTINUATION: {
            'entry_buffer_pct': 0.5,
            'stop_buffer_pct': 2.0,
            'target_1_rr': 2.0,
            'target_2_rr': 4.0,
        },
        SetupType.MEAN_REVERSION: {
            'entry_buffer_pct': 0.3,
            'stop_buffer_pct': 1.0,
            'target_1_rr': 1.0,
            'target_2_rr': 2.0,
        },
    }
    
    def __init__(self, db_pool, feature_engineer, ensemble_predictor, config: Dict = None):
        self.db_pool = db_pool
        self.feature_engineer = feature_engineer
        self.ensemble_predictor = ensemble_predictor
        self.config = config or {}
    
    async def generate_setup(
        self,
        symbol: str,
        timeframe: str = '1h'
    ) -> Optional[TradeSetup]:
        """
        Generate a trade setup for a symbol
        """
        # Get features
        feature_set = await self.feature_engineer.compute_features(symbol, timeframe)
        
        if not feature_set.features:
            logger.warning(f"No features available for {symbol}")
            return None
        
        # Get ML predictions
        features_df = pd.DataFrame([feature_set.features])
        predictions = await self.ensemble_predictor.predict(symbol, features_df)
        
        # Compute setup score and direction
        confidence, direction = self.ensemble_predictor.compute_setup_score(predictions)
        
        # Check minimum confidence
        if confidence < self.MIN_CONFIDENCE:
            logger.debug(f"{symbol}: Confidence {confidence:.2f} below threshold")
            return None
        
        if direction == 'NEUTRAL':
            logger.debug(f"{symbol}: Direction is neutral, skipping")
            return None
        
        # Determine setup type based on features and regime
        setup_type = self._determine_setup_type(feature_set, predictions)
        
        # Get current price
        current_price = await self._get_current_price(symbol)
        if current_price is None:
            return None
        
        # Calculate price levels
        levels = self._calculate_price_levels(
            current_price,
            direction,
            setup_type,
            feature_set.features
        )
        
        # Calculate risk/reward
        rr_ratio = self._calculate_rr_ratio(
            current_price,
            direction,
            levels['invalidation'],
            levels['target_1']
        )
        
        if rr_ratio < self.MIN_RR_RATIO:
            logger.debug(f"{symbol}: R:R {rr_ratio:.2f} below threshold")
            return None
        
        # Calculate quality score
        quality_score = self._calculate_quality_score(
            confidence, rr_ratio, feature_set, predictions
        )
        
        # Build supporting factors
        supporting_factors = self._build_supporting_factors(feature_set, predictions)
        risk_factors = self._build_risk_factors(feature_set, predictions)
        
        # Create setup
        setup = TradeSetup(
            symbol=symbol,
            direction=direction,
            timeframe=timeframe,
            setup_type=setup_type,
            current_price=current_price,
            entry_min=levels['entry_min'],
            entry_max=levels['entry_max'],
            invalidation=levels['invalidation'],
            target_1=levels['target_1'],
            target_2=levels.get('target_2'),
            target_max=levels.get('target_max'),
            confidence_score=confidence,
            risk_reward_ratio=rr_ratio,
            quality_score=quality_score,
            regime=feature_set.regime.value if feature_set.regime else None,
            supporting_factors=supporting_factors,
            risk_factors=risk_factors,
            model_predictions={
                k: {
                    'class': v.prediction_class,
                    'confidence': v.confidence,
                    'probabilities': v.probability_distribution
                }
                for k, v in predictions.items()
            },
            feature_snapshot=feature_set.features
        )
        
        return setup
    
    def _determine_setup_type(
        self,
        feature_set,
        predictions: Dict
    ) -> SetupType:
        """Determine setup type based on features and predictions"""
        features = feature_set.features
        regime = feature_set.regime
        
        # Check for breakout signals
        if predictions.get('breakout'):
            breakout_prob = predictions['breakout'].prediction_value
            if breakout_prob > 0.6:
                range_pos = features.get('range_position_20', 0.5)
                if range_pos > 0.9:
                    return SetupType.BREAKOUT
                elif range_pos < 0.1:
                    return SetupType.BREAKDOWN
        
        # Check for trend continuation
        adx = features.get('adx', 25)
        if adx > 30:
            price_vs_ma = features.get('price_vs_ma_50', 0)
            if price_vs_ma > 0:
                return SetupType.TREND_CONTINUATION
        
        # Check for mean reversion
        rsi = features.get('rsi_14', 50)
        if rsi < 30 or rsi > 70:
            return SetupType.MEAN_REVERSION
        
        # Default to momentum
        return SetupType.MOMENTUM
    
    def _calculate_price_levels(
        self,
        current_price: float,
        direction: str,
        setup_type: SetupType,
        features: Dict[str, float]
    ) -> Dict[str, float]:
        """Calculate entry, stop, and target levels"""
        config = self.SETUP_CONFIGS.get(setup_type, self.SETUP_CONFIGS[SetupType.TREND_CONTINUATION])
        
        entry_buffer = config['entry_buffer_pct'] / 100
        stop_buffer = config['stop_buffer_pct'] / 100
        
        # Get ATR for volatility-adjusted levels
        atr_pct = features.get('atr_14', 2.0)  # Default 2%
        
        if direction == 'LONG':
            entry_min = current_price * (1 - entry_buffer)
            entry_max = current_price * (1 + entry_buffer / 2)
            invalidation = current_price * (1 - stop_buffer * (atr_pct / 100) / 0.02)
            
            risk = current_price - invalidation
            target_1 = current_price + (risk * config['target_1_rr'])
            target_2 = current_price + (risk * config['target_2_rr'])
            target_max = current_price + (risk * config['target_2_rr'] * 1.5)
        else:  # SHORT
            entry_min = current_price * (1 - entry_buffer / 2)
            entry_max = current_price * (1 + entry_buffer)
            invalidation = current_price * (1 + stop_buffer * (atr_pct / 100) / 0.02)
            
            risk = invalidation - current_price
            target_1 = current_price - (risk * config['target_1_rr'])
            target_2 = current_price - (risk * config['target_2_rr'])
            target_max = current_price - (risk * config['target_2_rr'] * 1.5)
        
        return {
            'entry_min': round(entry_min, 8),
            'entry_max': round(entry_max, 8),
            'invalidation': round(invalidation, 8),
            'target_1': round(target_1, 8),
            'target_2': round(target_2, 8),
            'target_max': round(target_max, 8),
        }
    
    def _calculate_rr_ratio(
        self,
        entry: float,
        direction: str,
        stop: float,
        target: float
    ) -> float:
        """Calculate risk/reward ratio"""
        if direction == 'LONG':
            risk = entry - stop
            reward = target - entry
        else:
            risk = stop - entry
            reward = entry - target
        
        if risk <= 0:
            return 0
        
        return round(reward / risk, 2)
    
    def _calculate_quality_score(
        self,
        confidence: float,
        rr_ratio: float,
        feature_set,
        predictions: Dict
    ) -> float:
        """Calculate overall quality score"""
        score = 0.0
        
        # Confidence contributes 40%
        score += confidence * 0.4
        
        # R:R ratio contributes 30% (normalized)
        rr_normalized = min(rr_ratio / 5.0, 1.0)
        score += rr_normalized * 0.3
        
        # Regime alignment contributes 15%
        if feature_set.regime:
            regime = feature_set.regime.value
            direction_pred = predictions.get('direction', {})
            if direction_pred:
                dir_class = direction_pred.prediction_class
                if (regime == 'trending_up' and dir_class == 'UP') or \
                   (regime == 'trending_down' and dir_class == 'DOWN'):
                    score += 0.15
        
        # Multi-model agreement contributes 15%
        agreement_count = sum(
            1 for p in predictions.values() 
            if p.confidence > 0.6
        )
        score += (agreement_count / max(len(predictions), 1)) * 0.15
        
        return round(score, 3)
    
    def _build_supporting_factors(
        self,
        feature_set,
        predictions: Dict
    ) -> Dict[str, Any]:
        """Build supporting factors for the setup"""
        factors = {
            'technical': [],
            'ml_signals': [],
            'regime': None,
            'summary': ''
        }
        
        features = feature_set.features
        
        # Technical factors
        rsi = features.get('rsi_14', 50)
        if rsi < 30:
            factors['technical'].append(f"RSI oversold ({rsi:.1f})")
        elif rsi > 70:
            factors['technical'].append(f"RSI overbought ({rsi:.1f})")
        
        macd_hist = features.get('macd_histogram', 0)
        if macd_hist > 0:
            factors['technical'].append("MACD bullish crossover")
        elif macd_hist < 0:
            factors['technical'].append("MACD bearish crossover")
        
        price_vs_ma = features.get('price_vs_ma_50', 0)
        if price_vs_ma > 2:
            factors['technical'].append(f"Price {price_vs_ma:.1f}% above 50 MA")
        elif price_vs_ma < -2:
            factors['technical'].append(f"Price {abs(price_vs_ma):.1f}% below 50 MA")
        
        # ML signals
        for model_name, pred in predictions.items():
            if pred.confidence > 0.6:
                factors['ml_signals'].append(
                    f"{model_name}: {pred.prediction_class} ({pred.confidence:.0%})"
                )
        
        # Regime
        if feature_set.regime:
            factors['regime'] = feature_set.regime.value
        
        # Generate summary
        tech_summary = ", ".join(factors['technical'][:3]) if factors['technical'] else "No strong technical signals"
        ml_summary = ", ".join(factors['ml_signals'][:2]) if factors['ml_signals'] else "No strong ML signals"
        factors['summary'] = f"Technical: {tech_summary}. ML: {ml_summary}."
        
        return factors
    
    def _build_risk_factors(
        self,
        feature_set,
        predictions: Dict
    ) -> Dict[str, Any]:
        """Build risk factors for the setup"""
        factors = {
            'warnings': [],
            'volatility_risk': 'medium',
            'liquidity_risk': 'low',
        }
        
        features = feature_set.features
        
        # Volatility risk
        vol = features.get('volatility_20', 0)
        if vol > 100:  # Annualized > 100%
            factors['warnings'].append("High volatility environment")
            factors['volatility_risk'] = 'high'
        
        # Divergence warnings
        oi_div = features.get('oi_price_divergence_24', 0)
        if abs(oi_div) > 10:
            factors['warnings'].append(f"OI/Price divergence: {oi_div:.1f}%")
        
        # Funding rate extreme
        funding = features.get('funding_current', 0)
        if abs(funding) > 0.001:  # > 0.1%
            direction = "positive" if funding > 0 else "negative"
            factors['warnings'].append(f"Extreme {direction} funding rate")
        
        # Low confidence warning
        for model_name, pred in predictions.items():
            if pred.confidence < 0.4:
                factors['warnings'].append(f"Low {model_name} confidence")
        
        return factors
    
    async def _get_current_price(self, symbol: str) -> Optional[float]:
        """Get current price from database"""
        try:
            async with self.db_pool.acquire() as conn:
                row = await conn.fetchrow("""
                    SELECT close FROM market_data
                    WHERE symbol = $1 AND timeframe = '1m'
                    ORDER BY timestamp DESC
                    LIMIT 1
                """, symbol)
            
            if row:
                return float(row['close'])
        except Exception as e:
            logger.error(f"Failed to get price for {symbol}: {e}")
        
        return None
    
    async def save_setup(self, setup: TradeSetup) -> int:
        """Save setup to database"""
        async with self.db_pool.acquire() as conn:
            result = await conn.fetchrow("""
                INSERT INTO trade_setups
                (symbol, direction, timeframe, setup_type,
                 confidence_score, risk_reward_ratio, quality_score,
                 current_price, entry_min, entry_max, invalidation,
                 target_1, target_2, target_max,
                 regime, market_condition,
                 supporting_factors, risk_factors, model_predictions, feature_snapshot,
                 status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                RETURNING id
            """,
                setup.symbol,
                setup.direction,
                setup.timeframe,
                setup.setup_type.value,
                setup.confidence_score,
                setup.risk_reward_ratio,
                setup.quality_score,
                setup.current_price,
                setup.entry_min,
                setup.entry_max,
                setup.invalidation,
                setup.target_1,
                setup.target_2,
                setup.target_max,
                setup.regime,
                setup.market_condition,
                json.dumps(setup.supporting_factors),
                json.dumps(setup.risk_factors),
                json.dumps(setup.model_predictions),
                json.dumps(setup.feature_snapshot),
                setup.status.value
            )
            
            return result['id']
    
    async def get_active_setups(
        self,
        min_confidence: float = 0.5,
        limit: int = 20
    ) -> List[TradeSetup]:
        """Get active trade setups"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM trade_setups
                WHERE status = 'ACTIVE'
                AND confidence_score >= $1
                ORDER BY quality_score DESC, confidence_score DESC
                LIMIT $2
            """, min_confidence, limit)
        
        setups = []
        for row in rows:
            setup = TradeSetup(
                id=row['id'],
                symbol=row['symbol'],
                direction=row['direction'],
                timeframe=row['timeframe'],
                setup_type=SetupType(row['setup_type']),
                current_price=float(row['current_price']),
                entry_min=float(row['entry_min']),
                entry_max=float(row['entry_max']),
                invalidation=float(row['invalidation']),
                target_1=float(row['target_1']) if row['target_1'] else None,
                target_2=float(row['target_2']) if row['target_2'] else None,
                target_max=float(row['target_max']) if row['target_max'] else None,
                confidence_score=float(row['confidence_score']),
                risk_reward_ratio=float(row['risk_reward_ratio']),
                quality_score=float(row['quality_score']),
                regime=row['regime'],
                supporting_factors=json.loads(row['supporting_factors']) if row['supporting_factors'] else {},
                risk_factors=json.loads(row['risk_factors']) if row['risk_factors'] else {},
                model_predictions=json.loads(row['model_predictions']) if row['model_predictions'] else {},
                feature_snapshot=json.loads(row['feature_snapshot']) if row['feature_snapshot'] else {},
                created_at=row['created_at'],
                status=SetupStatus(row['status'])
            )
            setups.append(setup)
        
        return setups
    
    async def update_setup_status(
        self,
        setup_id: int,
        new_status: SetupStatus,
        reason: str = None
    ):
        """Update setup status"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE trade_setups
                SET status = $1,
                    updated_at = NOW(),
                    invalidation_reason = $2,
                    invalidated_at = CASE WHEN $1 = 'INVALIDATED' THEN NOW() ELSE invalidated_at END
                WHERE id = $3
            """, new_status.value, reason, setup_id)
    
    async def check_setup_validity(self, setup: TradeSetup) -> Tuple[bool, Optional[str]]:
        """Check if a setup is still valid"""
        current_price = await self._get_current_price(setup.symbol)
        
        if current_price is None:
            return True, None  # Can't check, assume valid
        
        # Check invalidation level
        if setup.direction == 'LONG':
            if current_price < setup.invalidation:
                return False, "Price below invalidation level"
        else:
            if current_price > setup.invalidation:
                return False, "Price above invalidation level"
        
        # Check if too far from entry
        entry_mid = (setup.entry_min + setup.entry_max) / 2
        distance_pct = abs(current_price - entry_mid) / entry_mid * 100
        
        if distance_pct > 5:  # More than 5% from entry
            return False, f"Price moved too far from entry ({distance_pct:.1f}%)"
        
        return True, None
