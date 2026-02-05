"""
═══════════════════════════════════════════════════════════════════════════════
INTELLIGENCE ENGINE - 6-Model AI Consensus System
═══════════════════════════════════════════════════════════════════════════════
Core Component: Multi-LLM Prediction Aggregation with Dynamic Weighting
Models: GPT-4o, Claude 3.5, Gemini Pro, Perplexity, Mistral, DeepSeek
"""

import asyncio
import aiohttp
import statistics
import json
import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from abc import ABC, abstractmethod

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class ModelPrediction:
    """Single model prediction result"""
    model_name: str
    probability: float  # 0.0 to 1.0
    confidence: float   # 0.0 to 1.0
    reasoning: str
    latency_ms: int
    tokens_used: int
    timestamp: datetime


@dataclass
class ConsensusResult:
    """Weighted ensemble consensus"""
    fair_probability: float
    confidence_score: float
    dispersion_metric: float  # Std dev of model predictions
    model_weights: Dict[str, float]
    individual_forecasts: List[ModelPrediction]
    recommendation: str  # STRONG_YES, YES, NEUTRAL, NO, STRONG_NO


class ModelPerformance:
    """Track and update model performance metrics"""
    
    def __init__(self, db_connection=None):
        self.db = db_connection
        # Default weights (equal initially)
        self._weights = {
            'gpt-4o': 0.20,
            'claude-3.5': 0.18,
            'gemini-pro': 0.15,
            'perplexity': 0.17,
            'mistral': 0.15,
            'deepseek': 0.15
        }
        self._brier_scores = {model: 0.20 for model in self._weights}
    
    def get_weight(self, model_name: str) -> float:
        return self._weights.get(model_name, 0.1)
    
    def get_all_weights(self) -> Dict[str, float]:
        return self._weights.copy()
    
    def calculate_brier_score(self, forecast: float, outcome: bool) -> float:
        """
        Brier Score = (Forecast - Outcome)^2
        Lower is better (0 = perfect, 1 = worst)
        """
        return (forecast - int(outcome)) ** 2
    
    def update_weights_from_brier(self, rolling_brier_scores: Dict[str, float]):
        """
        Update weights using inverse Brier score method
        Better models (lower Brier) get higher weights
        """
        # Prevent division by zero
        epsilon = 0.01
        
        # Calculate inverse scores
        inverse_scores = {
            model: 1.0 / max(score, epsilon)
            for model, score in rolling_brier_scores.items()
        }
        
        # Normalize to sum to 1
        total = sum(inverse_scores.values())
        self._weights = {
            model: score / total
            for model, score in inverse_scores.items()
        }
        
        logger.info(f"Updated model weights: {self._weights}")
    
    def penalize_overconfidence(self, model: str, confidence: float, was_correct: bool):
        """
        Penalize models that are confident but wrong
        Applies a multiplicative penalty to the weight
        """
        if not was_correct and confidence > 0.8:
            penalty = 1.0 - (confidence - 0.8) * 0.5  # Up to 10% penalty
            self._weights[model] *= penalty
            
            # Renormalize
            total = sum(self._weights.values())
            self._weights = {k: v/total for k, v in self._weights.items()}


class LLMClient(ABC):
    """Abstract base class for LLM API clients"""
    
    @abstractmethod
    async def get_prediction(self, question: str, context: str) -> ModelPrediction:
        pass


class GPT4Client(LLMClient):
    """OpenAI GPT-4o Client"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.model = "gpt-4o"
        self.base_url = "https://api.openai.com/v1/chat/completions"
    
    async def get_prediction(self, question: str, context: str) -> ModelPrediction:
        start_time = datetime.now()
        
        prompt = f"""You are a prediction market analyst. Analyze this question and provide a probability estimate.

Question: {question}

Context: {context}

Respond in JSON format:
{{
    "probability": 0.XX,  // Your probability estimate (0.0 to 1.0)
    "confidence": 0.XX,   // How confident you are in this estimate (0.0 to 1.0)
    "reasoning": "Brief explanation of your analysis"
}}"""
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                self.base_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.3,
                    "max_tokens": 500
                }
            ) as response:
                data = await response.json()
                
        latency = int((datetime.now() - start_time).total_seconds() * 1000)
        
        try:
            result = json.loads(data['choices'][0]['message']['content'])
            tokens = data.get('usage', {}).get('total_tokens', 0)
        except:
            result = {"probability": 0.5, "confidence": 0.3, "reasoning": "Error parsing response"}
            tokens = 0
        
        return ModelPrediction(
            model_name="gpt-4o",
            probability=float(result.get('probability', 0.5)),
            confidence=float(result.get('confidence', 0.5)),
            reasoning=result.get('reasoning', ''),
            latency_ms=latency,
            tokens_used=tokens,
            timestamp=datetime.now()
        )


class ClaudeClient(LLMClient):
    """Anthropic Claude 3.5 Client"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.model = "claude-3-5-sonnet-20241022"
        self.base_url = "https://api.anthropic.com/v1/messages"
    
    async def get_prediction(self, question: str, context: str) -> ModelPrediction:
        start_time = datetime.now()
        
        prompt = f"""Analyze this prediction market question and provide a probability estimate.

Question: {question}
Context: {context}

Respond ONLY with JSON:
{{"probability": 0.XX, "confidence": 0.XX, "reasoning": "your analysis"}}"""
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                self.base_url,
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.model,
                    "max_tokens": 500,
                    "messages": [{"role": "user", "content": prompt}]
                }
            ) as response:
                data = await response.json()
        
        latency = int((datetime.now() - start_time).total_seconds() * 1000)
        
        try:
            content = data['content'][0]['text']
            result = json.loads(content)
            tokens = data.get('usage', {}).get('input_tokens', 0) + data.get('usage', {}).get('output_tokens', 0)
        except:
            result = {"probability": 0.5, "confidence": 0.3, "reasoning": "Error"}
            tokens = 0
        
        return ModelPrediction(
            model_name="claude-3.5",
            probability=float(result.get('probability', 0.5)),
            confidence=float(result.get('confidence', 0.5)),
            reasoning=result.get('reasoning', ''),
            latency_ms=latency,
            tokens_used=tokens,
            timestamp=datetime.now()
        )


class MockLLMClient(LLMClient):
    """Mock client for testing without API costs"""
    
    def __init__(self, model_name: str, base_prob: float = 0.5, variance: float = 0.1):
        self.model_name = model_name
        self.base_prob = base_prob
        self.variance = variance
    
    async def get_prediction(self, question: str, context: str) -> ModelPrediction:
        import random
        
        # Simulate some variation between models
        prob = max(0.05, min(0.95, self.base_prob + random.gauss(0, self.variance)))
        conf = max(0.3, min(0.95, 0.7 + random.gauss(0, 0.1)))
        
        # Simulate latency
        await asyncio.sleep(random.uniform(0.1, 0.5))
        
        return ModelPrediction(
            model_name=self.model_name,
            probability=prob,
            confidence=conf,
            reasoning=f"Mock analysis for {self.model_name}",
            latency_ms=random.randint(100, 500),
            tokens_used=random.randint(200, 400),
            timestamp=datetime.now()
        )


class AIConsensusEngine:
    """
    Main consensus engine that aggregates predictions from 6 LLMs
    Uses dynamic weighting based on historical Brier scores
    """
    
    MODELS = ['gpt-4o', 'claude-3.5', 'gemini-pro', 'perplexity', 'mistral', 'deepseek']
    
    def __init__(self, api_keys: Dict[str, str] = None, use_mock: bool = False):
        self.performance = ModelPerformance()
        self.use_mock = use_mock
        
        if use_mock:
            # Create mock clients for testing
            self.clients = {
                model: MockLLMClient(model, base_prob=0.6, variance=0.12)
                for model in self.MODELS
            }
        else:
            # Initialize real API clients
            self.clients = {}
            if api_keys:
                if api_keys.get('openai'):
                    self.clients['gpt-4o'] = GPT4Client(api_keys['openai'])
                if api_keys.get('anthropic'):
                    self.clients['claude-3.5'] = ClaudeClient(api_keys['anthropic'])
                # Add other clients as implemented...
    
    async def get_consensus(self, question: str, context: str = "") -> ConsensusResult:
        """
        Main method: Get weighted consensus from all models
        
        Formula: P_final = Σ(w_i × P_i) where w = dynamic weights from Brier scores
        """
        
        # Query all models concurrently
        tasks = [
            self._get_model_prediction(model, question, context)
            for model in self.clients.keys()
        ]
        
        predictions = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Filter out errors
        valid_predictions = [p for p in predictions if isinstance(p, ModelPrediction)]
        
        if not valid_predictions:
            raise ValueError("No valid predictions received from any model")
        
        # Get weights
        weights = self.performance.get_all_weights()
        
        # Calculate weighted probability
        weighted_sum = 0.0
        weight_total = 0.0
        
        for pred in valid_predictions:
            w = weights.get(pred.model_name, 0.1)
            weighted_sum += w * pred.probability
            weight_total += w
        
        fair_probability = weighted_sum / weight_total if weight_total > 0 else 0.5
        
        # Calculate dispersion (std dev)
        probs = [p.probability for p in valid_predictions]
        dispersion = statistics.stdev(probs) if len(probs) > 1 else 0.0
        
        # Calculate confidence (inverse of dispersion + avg model confidence)
        avg_confidence = statistics.mean([p.confidence for p in valid_predictions])
        confidence_score = avg_confidence * (1 - dispersion)
        
        # Generate recommendation
        recommendation = self._generate_recommendation(fair_probability, confidence_score, dispersion)
        
        return ConsensusResult(
            fair_probability=round(fair_probability, 4),
            confidence_score=round(confidence_score, 4),
            dispersion_metric=round(dispersion, 4),
            model_weights={p.model_name: weights.get(p.model_name, 0.1) for p in valid_predictions},
            individual_forecasts=valid_predictions,
            recommendation=recommendation
        )
    
    async def _get_model_prediction(self, model: str, question: str, context: str) -> ModelPrediction:
        """Get prediction from a single model with error handling"""
        try:
            client = self.clients.get(model)
            if client:
                return await client.get_prediction(question, context)
        except Exception as e:
            logger.error(f"Error getting prediction from {model}: {e}")
        return None
    
    def _generate_recommendation(self, prob: float, confidence: float, dispersion: float) -> str:
        """Generate trading recommendation based on consensus"""
        if dispersion > 0.15:
            return "UNCERTAIN"  # High disagreement between models
        
        if confidence < 0.4:
            return "NEUTRAL"
        
        if prob >= 0.75:
            return "STRONG_YES" if confidence > 0.7 else "YES"
        elif prob >= 0.60:
            return "YES"
        elif prob <= 0.25:
            return "STRONG_NO" if confidence > 0.7 else "NO"
        elif prob <= 0.40:
            return "NO"
        else:
            return "NEUTRAL"
    
    def update_with_resolution(self, event_id: int, outcome: bool, predictions: List[ModelPrediction]):
        """
        Update model weights after an event resolves
        Called when we know the actual outcome
        """
        new_brier_scores = {}
        
        for pred in predictions:
            brier = self.performance.calculate_brier_score(pred.probability, outcome)
            new_brier_scores[pred.model_name] = brier
            
            # Apply overconfidence penalty
            was_correct = (pred.probability > 0.5) == outcome
            self.performance.penalize_overconfidence(pred.model_name, pred.confidence, was_correct)
        
        # This would merge with historical rolling average
        # For now, just log
        logger.info(f"Event {event_id} resolved: {outcome}. Brier scores: {new_brier_scores}")


# ═══════════════════════════════════════════════════════════════════════════════
# CALIBRATION SYSTEM
# ═══════════════════════════════════════════════════════════════════════════════

class CalibrationEngine:
    """
    Calibration system for adjusting model weights based on historical performance
    """
    
    def __init__(self, db_connection=None):
        self.db = db_connection
        self.rolling_window = 50  # Last N events for calibration
    
    def calculate_rolling_brier(self, model: str, predictions: List[Tuple[float, bool]]) -> float:
        """
        Calculate rolling Brier score for a model
        predictions: List of (forecast, outcome) tuples
        """
        if not predictions:
            return 0.25  # Default (random guessing)
        
        recent = predictions[-self.rolling_window:]
        brier_scores = [(p - int(o)) ** 2 for p, o in recent]
        return statistics.mean(brier_scores)
    
    def calculate_calibration_error(self, predictions: List[Tuple[float, bool]], n_bins: int = 10) -> float:
        """
        Expected Calibration Error (ECE)
        Measures how well-calibrated a model is
        """
        if not predictions:
            return 0.5
        
        # Bin predictions by probability
        bins = [[] for _ in range(n_bins)]
        
        for prob, outcome in predictions:
            bin_idx = min(int(prob * n_bins), n_bins - 1)
            bins[bin_idx].append((prob, outcome))
        
        # Calculate calibration error per bin
        ece = 0.0
        total = len(predictions)
        
        for bin_predictions in bins:
            if bin_predictions:
                avg_prob = statistics.mean([p for p, _ in bin_predictions])
                avg_outcome = statistics.mean([int(o) for _, o in bin_predictions])
                ece += len(bin_predictions) / total * abs(avg_prob - avg_outcome)
        
        return ece
    
    def get_calibrated_weights(self, model_metrics: Dict[str, Dict]) -> Dict[str, float]:
        """
        Calculate optimal weights based on:
        1. Rolling Brier score (primary)
        2. Calibration error (secondary)
        3. Overconfidence penalty
        """
        weights = {}
        
        for model, metrics in model_metrics.items():
            brier = metrics.get('rolling_brier', 0.25)
            cal_error = metrics.get('calibration_error', 0.5)
            overconf_penalty = metrics.get('overconfidence_penalty', 0)
            
            # Inverse Brier as base weight
            base_weight = 1.0 / max(brier, 0.01)
            
            # Penalize poor calibration
            base_weight *= (1 - cal_error * 0.5)
            
            # Apply overconfidence penalty
            base_weight *= (1 - overconf_penalty)
            
            weights[model] = base_weight
        
        # Normalize
        total = sum(weights.values())
        return {k: v/total for k, v in weights.items()}


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

async def main():
    """Demo the consensus engine"""
    
    # Use mock clients for testing
    engine = AIConsensusEngine(use_mock=True)
    
    question = "Will Bitcoin reach $150,000 before July 2026?"
    context = """
    Current BTC price: $98,500
    Recent ETF inflows: $1.2B daily average
    Halving occurred in April 2024
    Historical volatility suggests possible 50% moves
    """
    
    print("=" * 70)
    print("AI CONSENSUS ENGINE - 6 Model Prediction Aggregation")
    print("=" * 70)
    print(f"\nQuestion: {question}")
    print(f"\nContext: {context}")
    print("\n" + "-" * 70)
    
    result = await engine.get_consensus(question, context)
    
    print(f"\n📊 CONSENSUS RESULT")
    print(f"   Fair Probability: {result.fair_probability:.1%}")
    print(f"   Confidence Score: {result.confidence_score:.1%}")
    print(f"   Model Dispersion: {result.dispersion_metric:.1%}")
    print(f"   Recommendation:   {result.recommendation}")
    
    print(f"\n📈 MODEL WEIGHTS:")
    for model, weight in result.model_weights.items():
        print(f"   {model}: {weight:.1%}")
    
    print(f"\n🤖 INDIVIDUAL FORECASTS:")
    for pred in result.individual_forecasts:
        print(f"   {pred.model_name}: {pred.probability:.1%} (conf: {pred.confidence:.1%}) [{pred.latency_ms}ms]")


if __name__ == "__main__":
    asyncio.run(main())
