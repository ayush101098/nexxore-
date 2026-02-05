"""
═══════════════════════════════════════════════════════════════════════════════
EXECUTION ENGINE - Risk Management & Position Control
═══════════════════════════════════════════════════════════════════════════════
Middleware for risk checks, drawdown management, and trade execution
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Callable, Any
from datetime import datetime, timedelta
from enum import Enum
from collections import deque
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class OrderStatus(Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXECUTED = "EXECUTED"
    CANCELLED = "CANCELLED"
    PARTIAL = "PARTIAL"


class RejectionReason(Enum):
    MAX_DRAWDOWN = "MAX_DRAWDOWN_EXCEEDED"
    POSITION_LIMIT = "POSITION_LIMIT_EXCEEDED"
    DAILY_LOSS_LIMIT = "DAILY_LOSS_LIMIT"
    CORRELATION_RISK = "HIGH_CORRELATION_RISK"
    LOW_LIQUIDITY = "INSUFFICIENT_LIQUIDITY"
    CIRCUIT_BREAKER = "CIRCUIT_BREAKER_ACTIVE"
    INVALID_SIZE = "INVALID_SIZE"
    DUPLICATE_ORDER = "DUPLICATE_ORDER"


@dataclass
class Order:
    """Trade order"""
    order_id: str
    event_id: str
    platform: str
    side: str  # 'YES' or 'NO'
    size_usd: float
    price: float
    order_type: str  # 'MARKET', 'LIMIT'
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    created_at: datetime = field(default_factory=datetime.now)
    status: OrderStatus = OrderStatus.PENDING
    rejection_reason: Optional[RejectionReason] = None
    executed_price: Optional[float] = None
    executed_at: Optional[datetime] = None


@dataclass
class Position:
    """Current position in an event"""
    event_id: str
    platform: str
    side: str
    size_usd: float
    avg_entry_price: float
    current_price: float
    unrealized_pnl: float
    realized_pnl: float
    opened_at: datetime
    last_update: datetime


@dataclass
class RiskMetrics:
    """Real-time portfolio risk metrics"""
    total_equity: float
    total_exposure: float
    exposure_pct: float
    daily_pnl: float
    daily_pnl_pct: float
    max_drawdown: float
    current_drawdown: float
    sharpe_ratio: float
    win_rate: float
    avg_win: float
    avg_loss: float
    largest_position: float
    position_count: int
    correlation_risk: float
    timestamp: datetime


@dataclass
class RiskLimits:
    """Configurable risk limits"""
    max_drawdown_pct: float = 0.15  # 15% max drawdown
    max_daily_loss_pct: float = 0.05  # 5% max daily loss
    max_position_size_pct: float = 0.10  # 10% max single position
    max_total_exposure_pct: float = 0.50  # 50% max total exposure
    max_correlation_exposure: float = 0.30  # 30% in correlated events
    min_liquidity_ratio: float = 5.0  # Position must be < 20% of liquidity
    cooldown_after_loss_hours: int = 4  # Cooldown after significant loss


class PortfolioTracker:
    """
    Tracks portfolio positions and calculates risk metrics
    """
    
    def __init__(self, initial_capital: float):
        self.initial_capital = initial_capital
        self.current_capital = initial_capital
        self.high_water_mark = initial_capital
        
        self.positions: Dict[str, Position] = {}
        self.closed_trades: List[Dict] = []
        self.daily_pnl_history: deque = deque(maxlen=365)
        
        self._daily_start_equity = initial_capital
        self._last_daily_reset = datetime.now().date()
    
    def add_position(self, position: Position):
        """Add or update a position"""
        self.positions[position.event_id] = position
        self._recalculate()
    
    def close_position(self, event_id: str, exit_price: float):
        """Close a position and record the trade"""
        if event_id not in self.positions:
            return
        
        position = self.positions[event_id]
        
        # Calculate realized PnL
        if position.side == "YES":
            pnl = (exit_price - position.avg_entry_price) * position.size_usd / position.avg_entry_price
        else:
            pnl = (position.avg_entry_price - exit_price) * position.size_usd / (1 - position.avg_entry_price)
        
        # Record trade
        self.closed_trades.append({
            'event_id': event_id,
            'side': position.side,
            'entry_price': position.avg_entry_price,
            'exit_price': exit_price,
            'size_usd': position.size_usd,
            'pnl': pnl,
            'opened_at': position.opened_at,
            'closed_at': datetime.now()
        })
        
        # Update capital
        self.current_capital += pnl
        if self.current_capital > self.high_water_mark:
            self.high_water_mark = self.current_capital
        
        del self.positions[event_id]
        self._recalculate()
    
    def update_prices(self, price_updates: Dict[str, float]):
        """Update current prices for all positions"""
        for event_id, price in price_updates.items():
            if event_id in self.positions:
                pos = self.positions[event_id]
                pos.current_price = price
                
                # Calculate unrealized PnL
                if pos.side == "YES":
                    pos.unrealized_pnl = (price - pos.avg_entry_price) * pos.size_usd / pos.avg_entry_price
                else:
                    pos.unrealized_pnl = (pos.avg_entry_price - price) * pos.size_usd / (1 - pos.avg_entry_price)
                
                pos.last_update = datetime.now()
        
        self._recalculate()
    
    def _recalculate(self):
        """Recalculate portfolio metrics"""
        # Reset daily tracking if new day
        today = datetime.now().date()
        if today != self._last_daily_reset:
            self.daily_pnl_history.append({
                'date': self._last_daily_reset,
                'pnl': self.current_capital - self._daily_start_equity
            })
            self._daily_start_equity = self.current_capital
            self._last_daily_reset = today
    
    def get_total_exposure(self) -> float:
        """Total USD value at risk"""
        return sum(pos.size_usd for pos in self.positions.values())
    
    def get_unrealized_pnl(self) -> float:
        """Total unrealized PnL"""
        return sum(pos.unrealized_pnl for pos in self.positions.values())
    
    def get_daily_pnl(self) -> float:
        """Today's PnL"""
        return self.current_capital + self.get_unrealized_pnl() - self._daily_start_equity
    
    def get_current_drawdown(self) -> float:
        """Current drawdown from high water mark"""
        equity = self.current_capital + self.get_unrealized_pnl()
        return (self.high_water_mark - equity) / self.high_water_mark if self.high_water_mark > 0 else 0
    
    def get_win_rate(self) -> float:
        """Win rate of closed trades"""
        if not self.closed_trades:
            return 0.0
        wins = sum(1 for t in self.closed_trades if t['pnl'] > 0)
        return wins / len(self.closed_trades)
    
    def get_risk_metrics(self) -> RiskMetrics:
        """Get comprehensive risk metrics"""
        equity = self.current_capital + self.get_unrealized_pnl()
        exposure = self.get_total_exposure()
        
        # Calculate Sharpe ratio (simplified, using daily returns)
        if len(self.daily_pnl_history) >= 30:
            returns = [d['pnl'] / self.initial_capital for d in self.daily_pnl_history]
            avg_return = sum(returns) / len(returns)
            std_return = (sum((r - avg_return) ** 2 for r in returns) / len(returns)) ** 0.5
            sharpe = (avg_return * 252) / (std_return * (252 ** 0.5)) if std_return > 0 else 0
        else:
            sharpe = 0.0
        
        # Calculate average win/loss
        wins = [t['pnl'] for t in self.closed_trades if t['pnl'] > 0]
        losses = [t['pnl'] for t in self.closed_trades if t['pnl'] < 0]
        
        return RiskMetrics(
            total_equity=round(equity, 2),
            total_exposure=round(exposure, 2),
            exposure_pct=round(exposure / equity * 100, 2) if equity > 0 else 0,
            daily_pnl=round(self.get_daily_pnl(), 2),
            daily_pnl_pct=round(self.get_daily_pnl() / self._daily_start_equity * 100, 2) if self._daily_start_equity > 0 else 0,
            max_drawdown=round(0.0, 2),  # Would track historically
            current_drawdown=round(self.get_current_drawdown() * 100, 2),
            sharpe_ratio=round(sharpe, 2),
            win_rate=round(self.get_win_rate() * 100, 2),
            avg_win=round(sum(wins) / len(wins), 2) if wins else 0,
            avg_loss=round(sum(losses) / len(losses), 2) if losses else 0,
            largest_position=round(max((p.size_usd for p in self.positions.values()), default=0), 2),
            position_count=len(self.positions),
            correlation_risk=0.0,  # Would calculate based on event correlations
            timestamp=datetime.now()
        )


class RiskEngine:
    """
    Risk management middleware that approves or rejects trades
    """
    
    def __init__(
        self,
        portfolio: PortfolioTracker,
        limits: RiskLimits = None
    ):
        self.portfolio = portfolio
        self.limits = limits or RiskLimits()
        
        # Circuit breaker state
        self._circuit_breaker_active = False
        self._circuit_breaker_until: Optional[datetime] = None
        
        # Order tracking (for duplicate detection)
        self._recent_orders: deque = deque(maxlen=100)
        
        # Event correlations (would be loaded from DB)
        self._correlations: Dict[tuple, float] = {}
    
    def validate_order(self, order: Order) -> tuple[bool, Optional[RejectionReason]]:
        """
        Validate an order against all risk checks
        Returns: (approved, rejection_reason)
        """
        # Check circuit breaker
        if self._circuit_breaker_active:
            if datetime.now() < self._circuit_breaker_until:
                return False, RejectionReason.CIRCUIT_BREAKER
            else:
                self._circuit_breaker_active = False
        
        # Check for invalid size
        if order.size_usd <= 0 or order.size_usd > self.portfolio.current_capital:
            return False, RejectionReason.INVALID_SIZE
        
        # Check for duplicate order
        for recent in self._recent_orders:
            if (recent.event_id == order.event_id and 
                recent.side == order.side and
                abs(recent.size_usd - order.size_usd) < 1 and
                (datetime.now() - recent.created_at).seconds < 60):
                return False, RejectionReason.DUPLICATE_ORDER
        
        # Get current metrics
        metrics = self.portfolio.get_risk_metrics()
        
        # Check max drawdown
        if metrics.current_drawdown / 100 >= self.limits.max_drawdown_pct:
            self._trigger_circuit_breaker(hours=self.limits.cooldown_after_loss_hours)
            return False, RejectionReason.MAX_DRAWDOWN
        
        # Check daily loss limit
        if metrics.daily_pnl_pct <= -self.limits.max_daily_loss_pct * 100:
            self._trigger_circuit_breaker(hours=self.limits.cooldown_after_loss_hours)
            return False, RejectionReason.DAILY_LOSS_LIMIT
        
        # Check position size limit
        position_pct = order.size_usd / metrics.total_equity if metrics.total_equity > 0 else 1
        if position_pct > self.limits.max_position_size_pct:
            return False, RejectionReason.POSITION_LIMIT
        
        # Check total exposure limit
        new_exposure = metrics.total_exposure + order.size_usd
        exposure_pct = new_exposure / metrics.total_equity if metrics.total_equity > 0 else 1
        if exposure_pct > self.limits.max_total_exposure_pct:
            return False, RejectionReason.POSITION_LIMIT
        
        # Check correlation risk
        correlated_exposure = self._calculate_correlated_exposure(order.event_id, order.size_usd)
        if correlated_exposure / metrics.total_equity > self.limits.max_correlation_exposure:
            return False, RejectionReason.CORRELATION_RISK
        
        return True, None
    
    def _calculate_correlated_exposure(self, event_id: str, new_size: float) -> float:
        """Calculate exposure in correlated events"""
        correlated_exposure = new_size
        
        for pos in self.portfolio.positions.values():
            if pos.event_id == event_id:
                continue
            
            corr = self._correlations.get((event_id, pos.event_id), 0)
            if corr > 0.5:  # Consider significantly correlated
                correlated_exposure += pos.size_usd * corr
        
        return correlated_exposure
    
    def _trigger_circuit_breaker(self, hours: int):
        """Activate circuit breaker"""
        self._circuit_breaker_active = True
        self._circuit_breaker_until = datetime.now() + timedelta(hours=hours)
        logger.warning(f"Circuit breaker activated until {self._circuit_breaker_until}")
    
    async def process_order(self, order: Order) -> Order:
        """
        Process an order through risk checks
        """
        approved, rejection = self.validate_order(order)
        
        if approved:
            order.status = OrderStatus.APPROVED
            self._recent_orders.append(order)
            logger.info(f"Order {order.order_id} APPROVED: {order.side} ${order.size_usd} on {order.event_id}")
        else:
            order.status = OrderStatus.REJECTED
            order.rejection_reason = rejection
            logger.warning(f"Order {order.order_id} REJECTED: {rejection.value}")
        
        return order
    
    def set_correlation(self, event1: str, event2: str, correlation: float):
        """Set correlation between two events"""
        self._correlations[(event1, event2)] = correlation
        self._correlations[(event2, event1)] = correlation
    
    def get_risk_adjusted_size(self, base_size: float, event_id: str) -> float:
        """
        Adjust position size based on current risk state
        Returns reduced size if approaching limits
        """
        metrics = self.portfolio.get_risk_metrics()
        
        # Base adjustment
        adjusted = base_size
        
        # Reduce if drawdown is elevated
        if metrics.current_drawdown > 5:
            adjusted *= 0.75
        if metrics.current_drawdown > 10:
            adjusted *= 0.5
        
        # Reduce if daily loss is significant
        if metrics.daily_pnl_pct < -2:
            adjusted *= 0.75
        
        # Ensure within limits
        max_size = metrics.total_equity * self.limits.max_position_size_pct
        adjusted = min(adjusted, max_size)
        
        return round(adjusted, 2)


class ExecutionEngine:
    """
    Main execution engine that coordinates risk checks and order execution
    """
    
    def __init__(
        self,
        initial_capital: float,
        risk_limits: RiskLimits = None,
        on_order_executed: Callable[[Order], Any] = None
    ):
        self.portfolio = PortfolioTracker(initial_capital)
        self.risk_engine = RiskEngine(self.portfolio, risk_limits)
        self.on_order_executed = on_order_executed
        
        # Order queue
        self._order_queue: asyncio.Queue = asyncio.Queue()
        self._execution_task: Optional[asyncio.Task] = None
    
    async def start(self):
        """Start the execution engine"""
        self._execution_task = asyncio.create_task(self._process_orders())
        logger.info("Execution engine started")
    
    async def stop(self):
        """Stop the execution engine"""
        if self._execution_task:
            self._execution_task.cancel()
            try:
                await self._execution_task
            except asyncio.CancelledError:
                pass
        logger.info("Execution engine stopped")
    
    async def submit_order(self, order: Order):
        """Submit an order for processing"""
        await self._order_queue.put(order)
    
    async def _process_orders(self):
        """Process orders from queue"""
        while True:
            try:
                order = await self._order_queue.get()
                
                # Run through risk checks
                order = await self.risk_engine.process_order(order)
                
                if order.status == OrderStatus.APPROVED:
                    # Execute order (would call platform API)
                    order = await self._execute_order(order)
                
                # Callback
                if self.on_order_executed:
                    self.on_order_executed(order)
                
                self._order_queue.task_done()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error processing order: {e}")
    
    async def _execute_order(self, order: Order) -> Order:
        """
        Execute an approved order
        In production, this would call the platform API
        """
        # Simulate execution
        await asyncio.sleep(0.1)
        
        # Update order status
        order.status = OrderStatus.EXECUTED
        order.executed_price = order.price  # In reality, might have slippage
        order.executed_at = datetime.now()
        
        # Update portfolio
        position = Position(
            event_id=order.event_id,
            platform=order.platform,
            side=order.side,
            size_usd=order.size_usd,
            avg_entry_price=order.executed_price,
            current_price=order.executed_price,
            unrealized_pnl=0,
            realized_pnl=0,
            opened_at=datetime.now(),
            last_update=datetime.now()
        )
        
        self.portfolio.add_position(position)
        
        logger.info(f"Order {order.order_id} EXECUTED: {order.side} ${order.size_usd} @ {order.executed_price}")
        
        return order
    
    def get_status(self) -> Dict:
        """Get current execution engine status"""
        metrics = self.portfolio.get_risk_metrics()
        
        return {
            'portfolio': {
                'equity': metrics.total_equity,
                'exposure': metrics.total_exposure,
                'exposure_pct': metrics.exposure_pct,
                'daily_pnl': metrics.daily_pnl,
                'daily_pnl_pct': metrics.daily_pnl_pct,
                'current_drawdown': metrics.current_drawdown,
                'position_count': metrics.position_count
            },
            'risk': {
                'circuit_breaker': self.risk_engine._circuit_breaker_active,
                'win_rate': metrics.win_rate,
                'sharpe_ratio': metrics.sharpe_ratio
            },
            'positions': [
                {
                    'event_id': p.event_id,
                    'side': p.side,
                    'size': p.size_usd,
                    'entry': p.avg_entry_price,
                    'current': p.current_price,
                    'pnl': p.unrealized_pnl
                }
                for p in self.portfolio.positions.values()
            ]
        }


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN DEMO
# ═══════════════════════════════════════════════════════════════════════════════

async def main():
    """Demo the execution engine"""
    
    print("=" * 70)
    print("EXECUTION ENGINE - Risk Management & Position Control")
    print("=" * 70)
    
    # Initialize with $10k capital
    engine = ExecutionEngine(
        initial_capital=10000,
        risk_limits=RiskLimits(
            max_drawdown_pct=0.15,
            max_daily_loss_pct=0.05,
            max_position_size_pct=0.10,
            max_total_exposure_pct=0.50
        )
    )
    
    await engine.start()
    
    # Submit some orders
    orders = [
        Order(
            order_id="ORD-001",
            event_id="btc150k",
            platform="polymarket",
            side="YES",
            size_usd=500,
            price=0.45,
            order_type="MARKET"
        ),
        Order(
            order_id="ORD-002",
            event_id="fedcut",
            platform="kalshi",
            side="YES",
            size_usd=300,
            price=0.35,
            order_type="MARKET"
        ),
        Order(
            order_id="ORD-003",
            event_id="eth5k",
            platform="polymarket",
            side="NO",
            size_usd=400,
            price=0.38,
            order_type="MARKET"
        ),
        # This should be rejected (too large)
        Order(
            order_id="ORD-004",
            event_id="sol200",
            platform="polymarket",
            side="YES",
            size_usd=2000,  # 20% of capital, exceeds 10% limit
            price=0.25,
            order_type="MARKET"
        ),
    ]
    
    print("\n📋 Submitting orders...\n")
    
    for order in orders:
        await engine.submit_order(order)
    
    # Wait for processing
    await asyncio.sleep(1)
    
    # Print status
    status = engine.get_status()
    
    print("\n" + "=" * 70)
    print("📊 PORTFOLIO STATUS")
    print("=" * 70)
    
    print(f"\n💰 CAPITAL:")
    print(f"   Equity:        ${status['portfolio']['equity']:,.2f}")
    print(f"   Exposure:      ${status['portfolio']['exposure']:,.2f} ({status['portfolio']['exposure_pct']:.1f}%)")
    print(f"   Daily P&L:     ${status['portfolio']['daily_pnl']:+,.2f} ({status['portfolio']['daily_pnl_pct']:+.2f}%)")
    print(f"   Drawdown:      {status['portfolio']['current_drawdown']:.2f}%")
    
    print(f"\n📈 POSITIONS ({status['portfolio']['position_count']}):")
    for pos in status['positions']:
        print(f"   {pos['event_id']}: {pos['side']} ${pos['size']:.0f} @ {pos['entry']:.2%} (P&L: ${pos['pnl']:+.2f})")
    
    print(f"\n⚠️  RISK STATUS:")
    print(f"   Circuit Breaker: {'🔴 ACTIVE' if status['risk']['circuit_breaker'] else '🟢 INACTIVE'}")
    print(f"   Win Rate:        {status['risk']['win_rate']:.1f}%")
    
    await engine.stop()


if __name__ == "__main__":
    asyncio.run(main())
