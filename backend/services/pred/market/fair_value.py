"""
═══════════════════════════════════════════════════════════════════════════════
MARKET ENGINE - Fair Value Calculator & Edge Detection
═══════════════════════════════════════════════════════════════════════════════
Calculates fair value, expected value (EV), and optimal Kelly bet sizing
"""

import math
import statistics
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from enum import Enum


class MarketSide(Enum):
    YES = "YES"
    NO = "NO"


@dataclass
class MarketData:
    """Current market state"""
    event_id: str
    question: str
    yes_price: float  # Market probability for YES (0.0 to 1.0)
    no_price: float   # Market probability for NO
    volume_24h: float
    liquidity: float
    platform: str  # 'polymarket', 'kalshi', 'manifold', etc.
    last_update: datetime


@dataclass
class EdgeAnalysis:
    """Full edge analysis result"""
    fair_value: float
    market_price: float
    edge: float  # Fair - Market (positive = undervalued)
    edge_percent: float
    expected_value: float
    kelly_fraction: float
    recommended_size: float
    recommended_side: MarketSide
    confidence: float
    risk_adjusted_edge: float


@dataclass
class TradingSignal:
    """Actionable trading signal"""
    event_id: str
    platform: str
    side: MarketSide
    entry_price: float
    fair_value: float
    edge: float
    size_usd: float
    kelly_fraction: float
    stop_loss: Optional[float]
    take_profit: Optional[float]
    signal_strength: str  # 'STRONG', 'MEDIUM', 'WEAK'
    expires_at: datetime


class FairValueCalculator:
    """
    Calculates fair value and optimal bet sizing using Kelly Criterion
    """
    
    # Kelly fraction cap to avoid over-betting
    MAX_KELLY = 0.25  # Max 25% of bankroll per bet
    MIN_EDGE_THRESHOLD = 0.03  # 3% minimum edge to consider
    
    def __init__(self, bankroll: float = 10000.0, risk_tolerance: float = 0.5):
        """
        Args:
            bankroll: Total capital available for betting
            risk_tolerance: 0.0 to 1.0, scales Kelly fraction (0.5 = half-Kelly)
        """
        self.bankroll = bankroll
        self.risk_tolerance = risk_tolerance
    
    def calculate_fair_value(
        self,
        consensus_probability: float,
        consensus_confidence: float,
        model_dispersion: float
    ) -> float:
        """
        Calculate fair value with uncertainty adjustment
        
        Higher dispersion (disagreement) pulls toward 50%
        Lower confidence also pulls toward 50%
        """
        # Uncertainty factor: high dispersion/low confidence = more uncertain
        uncertainty = (1 - consensus_confidence) + model_dispersion
        uncertainty = min(uncertainty, 1.0)
        
        # Blend toward 0.5 based on uncertainty
        adjusted_fair = consensus_probability * (1 - uncertainty * 0.3) + 0.5 * (uncertainty * 0.3)
        
        return max(0.01, min(0.99, adjusted_fair))
    
    def calculate_edge(self, fair_value: float, market_price: float) -> Tuple[float, float, MarketSide]:
        """
        Calculate edge and recommended side
        
        Returns: (edge, edge_percent, recommended_side)
        """
        # Edge on YES side
        yes_edge = fair_value - market_price
        
        # Edge on NO side
        no_edge = (1 - fair_value) - (1 - market_price)  # Equivalent to -(fair_value - market_price)
        
        if yes_edge > abs(no_edge):
            return yes_edge, yes_edge / market_price if market_price > 0 else 0, MarketSide.YES
        else:
            return no_edge, no_edge / (1 - market_price) if market_price < 1 else 0, MarketSide.NO
    
    def calculate_expected_value(
        self,
        fair_value: float,
        market_price: float,
        bet_amount: float = 100.0
    ) -> float:
        """
        Calculate Expected Value of a YES bet
        
        EV = P(win) × Profit - P(lose) × Loss
        EV = fair_value × (1/market_price - 1) × bet - (1 - fair_value) × bet
        
        Simplified: EV = bet × (fair_value/market_price - 1)
        """
        if market_price <= 0 or market_price >= 1:
            return 0.0
        
        # Potential profit if YES wins: bet × (1/price - 1)
        profit_if_win = bet_amount * (1 / market_price - 1)
        loss_if_lose = bet_amount
        
        ev = fair_value * profit_if_win - (1 - fair_value) * loss_if_lose
        return ev
    
    def calculate_kelly_fraction(
        self,
        fair_value: float,
        market_price: float
    ) -> float:
        """
        Kelly Criterion for optimal bet sizing
        
        f* = (bp - q) / b
        
        Where:
        - b = odds received (1/price - 1)
        - p = probability of winning (fair_value)
        - q = probability of losing (1 - fair_value)
        
        f* = (p × (1/price - 1) - q) / (1/price - 1)
        f* = (p × (1 - price) - q × price) / (1 - price)
        f* = (p - price) / (1 - price)
        """
        if market_price <= 0 or market_price >= 1:
            return 0.0
        
        # For YES bet
        kelly = (fair_value - market_price) / (1 - market_price)
        
        # For NO bet (if negative Kelly on YES)
        if kelly < 0:
            kelly = ((1 - fair_value) - (1 - market_price)) / market_price
            kelly = (market_price - fair_value) / market_price
        
        # Apply risk tolerance (fractional Kelly)
        kelly *= self.risk_tolerance
        
        # Cap at max Kelly
        kelly = max(-self.MAX_KELLY, min(self.MAX_KELLY, kelly))
        
        return kelly
    
    def calculate_risk_adjusted_edge(
        self,
        edge: float,
        liquidity: float,
        time_to_resolution: int,  # hours
        volume_24h: float
    ) -> float:
        """
        Adjust edge for execution risk factors
        
        Factors:
        - Liquidity: Low liquidity = harder to exit
        - Time: Longer duration = more uncertainty
        - Volume: Low volume = less price discovery
        """
        # Liquidity factor (higher liquidity = better)
        liquidity_factor = min(1.0, liquidity / 100000)  # Normalize to $100k
        
        # Time decay (longer = worse)
        time_factor = 1 / (1 + time_to_resolution / 720)  # 720h = 30 days
        
        # Volume factor (higher = better)
        volume_factor = min(1.0, volume_24h / 50000)  # Normalize to $50k
        
        # Combined adjustment (geometric mean)
        adjustment = (liquidity_factor * time_factor * volume_factor) ** 0.33
        
        return edge * adjustment
    
    def analyze_edge(
        self,
        fair_value: float,
        market_data: MarketData,
        consensus_confidence: float,
        model_dispersion: float,
        time_to_resolution: int = 168  # Default 1 week
    ) -> EdgeAnalysis:
        """
        Complete edge analysis for a market
        """
        market_price = market_data.yes_price
        
        # Calculate raw edge
        edge, edge_pct, side = self.calculate_edge(fair_value, market_price)
        
        # Calculate EV
        ev = self.calculate_expected_value(fair_value, market_price, 100)
        
        # Calculate Kelly
        kelly = self.calculate_kelly_fraction(fair_value, market_price)
        
        # Risk-adjusted edge
        risk_adj_edge = self.calculate_risk_adjusted_edge(
            edge,
            market_data.liquidity,
            time_to_resolution,
            market_data.volume_24h
        )
        
        # Recommended position size
        recommended_size = abs(kelly) * self.bankroll
        
        return EdgeAnalysis(
            fair_value=round(fair_value, 4),
            market_price=round(market_price, 4),
            edge=round(edge, 4),
            edge_percent=round(edge_pct * 100, 2),
            expected_value=round(ev, 2),
            kelly_fraction=round(kelly, 4),
            recommended_size=round(recommended_size, 2),
            recommended_side=side,
            confidence=round(consensus_confidence, 4),
            risk_adjusted_edge=round(risk_adj_edge, 4)
        )
    
    def generate_signal(
        self,
        analysis: EdgeAnalysis,
        market_data: MarketData,
        time_to_resolution: int = 168
    ) -> Optional[TradingSignal]:
        """
        Generate actionable trading signal if edge exceeds threshold
        """
        # Check minimum edge threshold
        if abs(analysis.edge) < self.MIN_EDGE_THRESHOLD:
            return None
        
        # Check confidence threshold
        if analysis.confidence < 0.5:
            return None
        
        # Determine signal strength
        if abs(analysis.edge) >= 0.10 and analysis.confidence >= 0.7:
            strength = "STRONG"
        elif abs(analysis.edge) >= 0.05 and analysis.confidence >= 0.5:
            strength = "MEDIUM"
        else:
            strength = "WEAK"
        
        # Calculate stop loss and take profit
        entry = market_data.yes_price if analysis.recommended_side == MarketSide.YES else market_data.no_price
        
        # Stop loss: exit if price moves 50% of edge against us
        stop_loss = entry - analysis.edge * 0.5 if analysis.recommended_side == MarketSide.YES else entry + analysis.edge * 0.5
        stop_loss = max(0.01, min(0.99, stop_loss))
        
        # Take profit: exit at fair value (or slightly before)
        take_profit = analysis.fair_value * 0.95 if analysis.recommended_side == MarketSide.YES else (1 - analysis.fair_value) * 0.95
        
        return TradingSignal(
            event_id=market_data.event_id,
            platform=market_data.platform,
            side=analysis.recommended_side,
            entry_price=round(entry, 4),
            fair_value=analysis.fair_value,
            edge=analysis.edge,
            size_usd=analysis.recommended_size,
            kelly_fraction=analysis.kelly_fraction,
            stop_loss=round(stop_loss, 4),
            take_profit=round(take_profit, 4),
            signal_strength=strength,
            expires_at=datetime.now()
        )


class PortfolioOptimizer:
    """
    Multi-event portfolio optimization using Modern Portfolio Theory concepts
    """
    
    def __init__(self, max_portfolio_risk: float = 0.30):
        """
        Args:
            max_portfolio_risk: Maximum total Kelly exposure (e.g., 0.30 = 30%)
        """
        self.max_risk = max_portfolio_risk
    
    def optimize_allocations(
        self,
        signals: List[TradingSignal],
        correlations: Optional[Dict[Tuple[str, str], float]] = None
    ) -> Dict[str, float]:
        """
        Optimize bet sizes across multiple events
        
        Reduces position sizes when:
        1. Total Kelly exceeds max risk
        2. Events are correlated
        """
        if not signals:
            return {}
        
        # Calculate total raw Kelly
        total_kelly = sum(abs(s.kelly_fraction) for s in signals)
        
        if total_kelly <= self.max_risk:
            # Under risk limit, use full Kelly
            return {s.event_id: s.size_usd for s in signals}
        
        # Scale down proportionally
        scale_factor = self.max_risk / total_kelly
        
        allocations = {}
        for signal in signals:
            adjusted_size = signal.size_usd * scale_factor
            
            # Further reduce for correlated events
            if correlations:
                for other in signals:
                    if other.event_id != signal.event_id:
                        corr = correlations.get((signal.event_id, other.event_id), 0)
                        if corr > 0.5:
                            adjusted_size *= (1 - corr * 0.3)
            
            allocations[signal.event_id] = round(adjusted_size, 2)
        
        return allocations


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN DEMO
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    """Demo the fair value calculator"""
    
    # Example market data
    market = MarketData(
        event_id="btc-150k-2026",
        question="Will Bitcoin reach $150,000 before July 2026?",
        yes_price=0.42,  # Market says 42% chance
        no_price=0.58,
        volume_24h=85000,
        liquidity=250000,
        platform="polymarket",
        last_update=datetime.now()
    )
    
    # Initialize calculator with $10k bankroll, half-Kelly
    calc = FairValueCalculator(bankroll=10000, risk_tolerance=0.5)
    
    # Our model's consensus (from AI engine)
    consensus_prob = 0.58  # We think 58% chance
    confidence = 0.72
    dispersion = 0.08
    
    # Calculate fair value with uncertainty adjustment
    fair_value = calc.calculate_fair_value(consensus_prob, confidence, dispersion)
    
    # Full edge analysis
    analysis = calc.analyze_edge(
        fair_value=fair_value,
        market_data=market,
        consensus_confidence=confidence,
        model_dispersion=dispersion,
        time_to_resolution=168 * 4  # 4 weeks
    )
    
    # Generate signal
    signal = calc.generate_signal(analysis, market)
    
    print("=" * 70)
    print("FAIR VALUE CALCULATOR - Edge & Kelly Analysis")
    print("=" * 70)
    
    print(f"\n📊 MARKET: {market.question}")
    print(f"   Platform: {market.platform}")
    print(f"   Current YES Price: {market.yes_price:.1%}")
    print(f"   24h Volume: ${market.volume_24h:,.0f}")
    print(f"   Liquidity: ${market.liquidity:,.0f}")
    
    print(f"\n🎯 MODEL OUTPUT:")
    print(f"   Consensus Probability: {consensus_prob:.1%}")
    print(f"   Confidence Score: {confidence:.1%}")
    print(f"   Model Dispersion: {dispersion:.1%}")
    
    print(f"\n💰 EDGE ANALYSIS:")
    print(f"   Fair Value: {analysis.fair_value:.1%}")
    print(f"   Market Price: {analysis.market_price:.1%}")
    print(f"   Raw Edge: {analysis.edge:.1%} ({analysis.edge_percent:+.1f}%)")
    print(f"   Risk-Adjusted Edge: {analysis.risk_adjusted_edge:.1%}")
    print(f"   Expected Value (per $100): ${analysis.expected_value:+.2f}")
    
    print(f"\n📈 POSITION SIZING:")
    print(f"   Kelly Fraction: {analysis.kelly_fraction:.1%}")
    print(f"   Recommended Side: {analysis.recommended_side.value}")
    print(f"   Recommended Size: ${analysis.recommended_size:,.2f}")
    
    if signal:
        print(f"\n🚀 TRADING SIGNAL:")
        print(f"   Action: BUY {signal.side.value} @ {signal.entry_price:.1%}")
        print(f"   Size: ${signal.size_usd:,.2f}")
        print(f"   Stop Loss: {signal.stop_loss:.1%}")
        print(f"   Take Profit: {signal.take_profit:.1%}")
        print(f"   Signal Strength: {signal.signal_strength}")
    else:
        print(f"\n⚠️  NO SIGNAL: Edge below threshold or insufficient confidence")


if __name__ == "__main__":
    main()
