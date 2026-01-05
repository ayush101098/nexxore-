"""
ML Models - Direction prediction, breakout detection, and volatility forecasting
"""

import asyncio
import logging
import pickle
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
import json

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import TimeSeriesSplit

logger = logging.getLogger(__name__)


class PredictionType(str, Enum):
    DIRECTION = "direction"
    BREAKOUT = "breakout"
    VOLATILITY = "volatility"
    REGIME = "regime"


@dataclass
class ModelPrediction:
    """Container for model prediction"""
    symbol: str
    timestamp: datetime
    model_name: str
    prediction_type: PredictionType
    prediction_value: float
    prediction_class: Optional[str] = None
    confidence: float = 0.0
    probability_distribution: Dict[str, float] = field(default_factory=dict)
    feature_importance: Dict[str, float] = field(default_factory=dict)
    horizon: int = 1  # Prediction horizon in candles


class BaseModel:
    """Base class for all ML models"""
    
    def __init__(
        self,
        name: str,
        model_type: str,
        target_type: PredictionType,
        config: Dict[str, Any] = None
    ):
        self.name = name
        self.model_type = model_type
        self.target_type = target_type
        self.config = config or {}
        
        self.model = None
        self.scaler = StandardScaler()
        self.feature_names: List[str] = []
        self.is_trained = False
        self.version = "1.0.0"
        
        # Performance metrics
        self.metrics: Dict[str, float] = {}
    
    def preprocess(self, features: pd.DataFrame) -> np.ndarray:
        """Preprocess features for model input"""
        # Handle missing values
        features = features.fillna(0)
        
        # Scale features
        if self.is_trained:
            return self.scaler.transform(features)
        else:
            return self.scaler.fit_transform(features)
    
    def get_feature_importance(self) -> Dict[str, float]:
        """Get feature importance from trained model"""
        if not self.is_trained or not hasattr(self.model, 'feature_importances_'):
            return {}
        
        importances = self.model.feature_importances_
        return dict(zip(self.feature_names, importances))
    
    def save(self, path: str):
        """Save model to disk"""
        model_data = {
            'name': self.name,
            'model_type': self.model_type,
            'target_type': self.target_type.value,
            'version': self.version,
            'config': self.config,
            'feature_names': self.feature_names,
            'metrics': self.metrics,
            'model': self.model,
            'scaler': self.scaler,
        }
        
        with open(path, 'wb') as f:
            pickle.dump(model_data, f)
        
        logger.info(f"Saved model to {path}")
    
    @classmethod
    def load(cls, path: str) -> 'BaseModel':
        """Load model from disk"""
        with open(path, 'rb') as f:
            model_data = pickle.load(f)
        
        instance = cls(
            name=model_data['name'],
            model_type=model_data['model_type'],
            target_type=PredictionType(model_data['target_type']),
            config=model_data['config']
        )
        
        instance.model = model_data['model']
        instance.scaler = model_data['scaler']
        instance.feature_names = model_data['feature_names']
        instance.metrics = model_data['metrics']
        instance.version = model_data['version']
        instance.is_trained = True
        
        return instance


class DirectionModel(BaseModel):
    """
    XGBoost/LightGBM model for price direction prediction
    
    Target: Next N candles direction (up/down/neutral)
    Features: Technical indicators, momentum, volume, derivatives
    """
    
    def __init__(
        self,
        name: str = "direction_model",
        use_lightgbm: bool = True,
        config: Dict[str, Any] = None
    ):
        super().__init__(
            name=name,
            model_type="lightgbm" if use_lightgbm else "xgboost",
            target_type=PredictionType.DIRECTION,
            config=config or {}
        )
        
        self.use_lightgbm = use_lightgbm
        self.prediction_horizon = self.config.get('horizon', 4)  # Default 4 candles ahead
        self.threshold = self.config.get('threshold', 0.5)  # % threshold for direction
        
        self._init_model()
    
    def _init_model(self):
        """Initialize the model"""
        if self.use_lightgbm:
            import lightgbm as lgb
            
            self.model = lgb.LGBMClassifier(
                objective='multiclass',
                num_class=3,
                n_estimators=self.config.get('n_estimators', 500),
                max_depth=self.config.get('max_depth', 8),
                learning_rate=self.config.get('learning_rate', 0.05),
                subsample=self.config.get('subsample', 0.8),
                colsample_bytree=self.config.get('colsample_bytree', 0.8),
                reg_alpha=self.config.get('reg_alpha', 0.1),
                reg_lambda=self.config.get('reg_lambda', 0.1),
                random_state=42,
                verbose=-1
            )
        else:
            import xgboost as xgb
            
            self.model = xgb.XGBClassifier(
                objective='multi:softprob',
                num_class=3,
                n_estimators=self.config.get('n_estimators', 500),
                max_depth=self.config.get('max_depth', 8),
                learning_rate=self.config.get('learning_rate', 0.05),
                subsample=self.config.get('subsample', 0.8),
                colsample_bytree=self.config.get('colsample_bytree', 0.8),
                reg_alpha=self.config.get('reg_alpha', 0.1),
                reg_lambda=self.config.get('reg_lambda', 0.1),
                random_state=42,
                verbosity=0
            )
    
    def create_labels(
        self,
        close: pd.Series,
        horizon: int = None
    ) -> pd.Series:
        """Create direction labels from price data"""
        horizon = horizon or self.prediction_horizon
        
        # Calculate future returns
        future_return = (close.shift(-horizon) / close - 1) * 100
        
        # Classify direction
        # 0 = down, 1 = neutral, 2 = up
        labels = pd.Series(1, index=close.index)  # Default neutral
        labels[future_return > self.threshold] = 2  # Up
        labels[future_return < -self.threshold] = 0  # Down
        
        return labels
    
    def train(
        self,
        features: pd.DataFrame,
        labels: pd.Series,
        validation_split: float = 0.2
    ) -> Dict[str, float]:
        """Train the model with time-series cross-validation"""
        from sklearn.metrics import accuracy_score, f1_score, classification_report
        
        # Store feature names
        self.feature_names = list(features.columns)
        
        # Preprocess
        X = self.preprocess(features)
        y = labels.values
        
        # Remove samples with NaN labels
        valid_idx = ~np.isnan(y)
        X = X[valid_idx]
        y = y[valid_idx].astype(int)
        
        # Time series split
        split_idx = int(len(X) * (1 - validation_split))
        X_train, X_val = X[:split_idx], X[split_idx:]
        y_train, y_val = y[:split_idx], y[split_idx:]
        
        # Train
        if self.use_lightgbm:
            self.model.fit(
                X_train, y_train,
                eval_set=[(X_val, y_val)],
                callbacks=[
                    __import__('lightgbm').early_stopping(50, verbose=False),
                    __import__('lightgbm').log_evaluation(period=0)
                ]
            )
        else:
            self.model.fit(
                X_train, y_train,
                eval_set=[(X_val, y_val)],
                early_stopping_rounds=50,
                verbose=False
            )
        
        # Evaluate
        y_pred = self.model.predict(X_val)
        
        self.metrics = {
            'accuracy': accuracy_score(y_val, y_pred),
            'f1_weighted': f1_score(y_val, y_pred, average='weighted'),
            'f1_up': f1_score(y_val == 2, y_pred == 2),
            'f1_down': f1_score(y_val == 0, y_pred == 0),
        }
        
        self.is_trained = True
        logger.info(f"Model trained: {self.metrics}")
        
        return self.metrics
    
    def predict(
        self,
        features: pd.DataFrame
    ) -> ModelPrediction:
        """Make prediction for current features"""
        if not self.is_trained:
            raise ValueError("Model not trained")
        
        # Ensure features match training features
        missing_features = set(self.feature_names) - set(features.columns)
        if missing_features:
            logger.warning(f"Missing features: {missing_features}")
            for f in missing_features:
                features[f] = 0
        
        features = features[self.feature_names]
        
        # Preprocess
        X = self.scaler.transform(features)
        
        # Predict
        proba = self.model.predict_proba(X)[0]
        pred_class = int(np.argmax(proba))
        
        # Map to direction
        direction_map = {0: 'DOWN', 1: 'NEUTRAL', 2: 'UP'}
        
        return ModelPrediction(
            symbol="",  # To be filled by caller
            timestamp=datetime.now(timezone.utc),
            model_name=self.name,
            prediction_type=PredictionType.DIRECTION,
            prediction_value=pred_class,
            prediction_class=direction_map[pred_class],
            confidence=float(proba[pred_class]),
            probability_distribution={
                'down': float(proba[0]),
                'neutral': float(proba[1]),
                'up': float(proba[2])
            },
            feature_importance=self.get_feature_importance(),
            horizon=self.prediction_horizon
        )


class BreakoutModel(BaseModel):
    """
    Model for breakout/breakdown probability prediction
    
    Target: Probability of significant price move in next N candles
    Features: Range features, volume, volatility compression
    """
    
    def __init__(
        self,
        name: str = "breakout_model",
        config: Dict[str, Any] = None
    ):
        super().__init__(
            name=name,
            model_type="lightgbm",
            target_type=PredictionType.BREAKOUT,
            config=config or {}
        )
        
        self.breakout_threshold = self.config.get('breakout_threshold', 2.0)  # % move
        self.horizon = self.config.get('horizon', 12)  # Candles
        
        self._init_model()
    
    def _init_model(self):
        """Initialize the model"""
        import lightgbm as lgb
        
        self.model = lgb.LGBMClassifier(
            objective='binary',
            n_estimators=self.config.get('n_estimators', 300),
            max_depth=self.config.get('max_depth', 6),
            learning_rate=self.config.get('learning_rate', 0.05),
            class_weight='balanced',
            random_state=42,
            verbose=-1
        )
    
    def create_labels(
        self,
        high: pd.Series,
        low: pd.Series,
        close: pd.Series
    ) -> pd.Series:
        """Create breakout labels"""
        # Look for significant moves in the horizon
        future_high = high.rolling(self.horizon).max().shift(-self.horizon)
        future_low = low.rolling(self.horizon).min().shift(-self.horizon)
        
        up_move = (future_high / close - 1) * 100
        down_move = (close / future_low - 1) * 100
        
        max_move = pd.concat([up_move, down_move], axis=1).max(axis=1)
        
        # Binary label: 1 if breakout occurred
        labels = (max_move >= self.breakout_threshold).astype(int)
        
        return labels
    
    def train(
        self,
        features: pd.DataFrame,
        labels: pd.Series,
        validation_split: float = 0.2
    ) -> Dict[str, float]:
        """Train the breakout model"""
        from sklearn.metrics import precision_score, recall_score, roc_auc_score
        
        self.feature_names = list(features.columns)
        
        X = self.preprocess(features)
        y = labels.values
        
        valid_idx = ~np.isnan(y)
        X = X[valid_idx]
        y = y[valid_idx].astype(int)
        
        split_idx = int(len(X) * (1 - validation_split))
        X_train, X_val = X[:split_idx], X[split_idx:]
        y_train, y_val = y[:split_idx], y[split_idx:]
        
        self.model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            callbacks=[
                __import__('lightgbm').early_stopping(30, verbose=False),
                __import__('lightgbm').log_evaluation(period=0)
            ]
        )
        
        y_pred = self.model.predict(X_val)
        y_proba = self.model.predict_proba(X_val)[:, 1]
        
        self.metrics = {
            'precision': precision_score(y_val, y_pred),
            'recall': recall_score(y_val, y_pred),
            'auc_roc': roc_auc_score(y_val, y_proba),
        }
        
        self.is_trained = True
        return self.metrics
    
    def predict(self, features: pd.DataFrame) -> ModelPrediction:
        """Predict breakout probability"""
        if not self.is_trained:
            raise ValueError("Model not trained")
        
        features = features[self.feature_names]
        X = self.scaler.transform(features)
        
        proba = self.model.predict_proba(X)[0]
        
        return ModelPrediction(
            symbol="",
            timestamp=datetime.now(timezone.utc),
            model_name=self.name,
            prediction_type=PredictionType.BREAKOUT,
            prediction_value=float(proba[1]),  # Probability of breakout
            prediction_class="BREAKOUT" if proba[1] > 0.5 else "NO_BREAKOUT",
            confidence=float(max(proba)),
            probability_distribution={
                'no_breakout': float(proba[0]),
                'breakout': float(proba[1])
            },
            feature_importance=self.get_feature_importance(),
            horizon=self.horizon
        )


class VolatilityModel(BaseModel):
    """
    Model for volatility forecasting
    
    Target: Future realized volatility bucket
    Features: Historical volatility, ATR, Parkinson volatility
    """
    
    VOLATILITY_BUCKETS = ['very_low', 'low', 'medium', 'high', 'very_high']
    
    def __init__(
        self,
        name: str = "volatility_model",
        config: Dict[str, Any] = None
    ):
        super().__init__(
            name=name,
            model_type="lightgbm",
            target_type=PredictionType.VOLATILITY,
            config=config or {}
        )
        
        self.horizon = self.config.get('horizon', 24)
        self._init_model()
    
    def _init_model(self):
        """Initialize the model"""
        import lightgbm as lgb
        
        self.model = lgb.LGBMClassifier(
            objective='multiclass',
            num_class=5,
            n_estimators=self.config.get('n_estimators', 200),
            max_depth=self.config.get('max_depth', 6),
            learning_rate=self.config.get('learning_rate', 0.05),
            random_state=42,
            verbose=-1
        )
    
    def create_labels(
        self,
        close: pd.Series,
        percentiles: List[float] = [20, 40, 60, 80]
    ) -> pd.Series:
        """Create volatility bucket labels"""
        # Calculate future realized volatility
        returns = np.log(close / close.shift(1))
        future_vol = returns.rolling(self.horizon).std().shift(-self.horizon)
        future_vol = future_vol * np.sqrt(365 * 24)  # Annualize
        
        # Calculate percentile thresholds
        thresholds = np.percentile(future_vol.dropna(), percentiles)
        
        # Create bucket labels
        labels = pd.Series(2, index=close.index)  # Default medium
        labels[future_vol < thresholds[0]] = 0  # Very low
        labels[(future_vol >= thresholds[0]) & (future_vol < thresholds[1])] = 1  # Low
        labels[(future_vol >= thresholds[1]) & (future_vol < thresholds[2])] = 2  # Medium
        labels[(future_vol >= thresholds[2]) & (future_vol < thresholds[3])] = 3  # High
        labels[future_vol >= thresholds[3]] = 4  # Very high
        
        return labels
    
    def train(
        self,
        features: pd.DataFrame,
        labels: pd.Series,
        validation_split: float = 0.2
    ) -> Dict[str, float]:
        """Train the volatility model"""
        from sklearn.metrics import accuracy_score
        
        self.feature_names = list(features.columns)
        
        X = self.preprocess(features)
        y = labels.values
        
        valid_idx = ~np.isnan(y)
        X = X[valid_idx]
        y = y[valid_idx].astype(int)
        
        split_idx = int(len(X) * (1 - validation_split))
        X_train, X_val = X[:split_idx], X[split_idx:]
        y_train, y_val = y[:split_idx], y[split_idx:]
        
        self.model.fit(X_train, y_train)
        
        y_pred = self.model.predict(X_val)
        
        self.metrics = {
            'accuracy': accuracy_score(y_val, y_pred),
        }
        
        self.is_trained = True
        return self.metrics
    
    def predict(self, features: pd.DataFrame) -> ModelPrediction:
        """Predict volatility bucket"""
        if not self.is_trained:
            raise ValueError("Model not trained")
        
        features = features[self.feature_names]
        X = self.scaler.transform(features)
        
        proba = self.model.predict_proba(X)[0]
        pred_class = int(np.argmax(proba))
        
        return ModelPrediction(
            symbol="",
            timestamp=datetime.now(timezone.utc),
            model_name=self.name,
            prediction_type=PredictionType.VOLATILITY,
            prediction_value=pred_class,
            prediction_class=self.VOLATILITY_BUCKETS[pred_class],
            confidence=float(proba[pred_class]),
            probability_distribution={
                bucket: float(proba[i])
                for i, bucket in enumerate(self.VOLATILITY_BUCKETS)
            },
            feature_importance=self.get_feature_importance(),
            horizon=self.horizon
        )


class ModelRegistry:
    """
    Registry for managing trained models
    Handles versioning, storage, and retrieval
    """
    
    def __init__(self, db_pool, models_dir: str = "/app/models"):
        self.db_pool = db_pool
        self.models_dir = Path(models_dir)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        
        self._models: Dict[str, BaseModel] = {}
    
    async def register_model(
        self,
        model: BaseModel,
        deploy: bool = False
    ):
        """Register a trained model"""
        if not model.is_trained:
            raise ValueError("Cannot register untrained model")
        
        # Save to disk
        model_path = self.models_dir / f"{model.name}_{model.version}.pkl"
        model.save(str(model_path))
        
        # Save to database
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO model_registry 
                (model_name, model_version, model_type, target_type,
                 accuracy, precision_score, recall_score, f1_score, auc_roc,
                 model_path, hyperparameters, is_active, deployed_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (model_name, model_version) DO UPDATE SET
                accuracy = EXCLUDED.accuracy,
                is_active = EXCLUDED.is_active,
                deployed_at = EXCLUDED.deployed_at
            """,
                model.name,
                model.version,
                model.model_type,
                model.target_type.value,
                model.metrics.get('accuracy'),
                model.metrics.get('precision'),
                model.metrics.get('recall'),
                model.metrics.get('f1_weighted'),
                model.metrics.get('auc_roc'),
                str(model_path),
                json.dumps(model.config),
                deploy,
                datetime.now(timezone.utc) if deploy else None
            )
        
        # Cache model
        self._models[model.name] = model
        
        logger.info(f"Registered model: {model.name} v{model.version}")
    
    async def get_model(self, name: str) -> Optional[BaseModel]:
        """Get active model by name"""
        # Check cache
        if name in self._models:
            return self._models[name]
        
        # Load from database
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT model_path FROM model_registry
                WHERE model_name = $1 AND is_active = true
                ORDER BY created_at DESC
                LIMIT 1
            """, name)
        
        if row:
            model = BaseModel.load(row['model_path'])
            self._models[name] = model
            return model
        
        return None
    
    async def get_all_active_models(self) -> List[Dict]:
        """Get all active models"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT model_name, model_version, model_type, target_type,
                       accuracy, f1_score, auc_roc, deployed_at
                FROM model_registry
                WHERE is_active = true
                ORDER BY deployed_at DESC
            """)
        
        return [dict(r) for r in rows]


class EnsemblePredictor:
    """
    Ensemble that combines multiple models for final prediction
    """
    
    def __init__(self, model_registry: ModelRegistry):
        self.registry = model_registry
        
        # Weights for ensemble
        self.weights = {
            'direction': 0.4,
            'breakout': 0.3,
            'volatility': 0.3
        }
    
    async def predict(
        self,
        symbol: str,
        features: pd.DataFrame
    ) -> Dict[str, ModelPrediction]:
        """Get predictions from all models"""
        predictions = {}
        
        # Direction model
        direction_model = await self.registry.get_model('direction_model')
        if direction_model:
            pred = direction_model.predict(features)
            pred.symbol = symbol
            predictions['direction'] = pred
        
        # Breakout model
        breakout_model = await self.registry.get_model('breakout_model')
        if breakout_model:
            pred = breakout_model.predict(features)
            pred.symbol = symbol
            predictions['breakout'] = pred
        
        # Volatility model
        volatility_model = await self.registry.get_model('volatility_model')
        if volatility_model:
            pred = volatility_model.predict(features)
            pred.symbol = symbol
            predictions['volatility'] = pred
        
        return predictions
    
    def compute_setup_score(
        self,
        predictions: Dict[str, ModelPrediction]
    ) -> Tuple[float, str]:
        """
        Compute overall setup score from individual predictions
        Returns (score, direction)
        """
        score = 0.5  # Base score
        direction = 'NEUTRAL'
        
        if 'direction' in predictions:
            dir_pred = predictions['direction']
            probs = dir_pred.probability_distribution
            
            # Adjust score based on direction confidence
            up_prob = probs.get('up', 0.33)
            down_prob = probs.get('down', 0.33)
            
            if up_prob > 0.5:
                direction = 'LONG'
                score += (up_prob - 0.5) * self.weights['direction']
            elif down_prob > 0.5:
                direction = 'SHORT'
                score += (down_prob - 0.5) * self.weights['direction']
        
        if 'breakout' in predictions:
            breakout_pred = predictions['breakout']
            breakout_prob = breakout_pred.prediction_value
            
            # Higher breakout probability increases score
            score += (breakout_prob - 0.5) * self.weights['breakout']
        
        if 'volatility' in predictions:
            vol_pred = predictions['volatility']
            # Medium volatility is ideal
            if vol_pred.prediction_class in ['medium', 'high']:
                score += 0.1 * self.weights['volatility']
            elif vol_pred.prediction_class == 'very_high':
                score -= 0.1 * self.weights['volatility']
        
        return min(1.0, max(0.0, score)), direction
