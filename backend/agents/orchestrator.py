"""
Agent Orchestrator
Coordinates all agents and runs monitoring cycles
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import redis.asyncio as redis
from prometheus_client import Counter, Gauge, Histogram, start_http_server
from web3 import Web3

from .risk_agent import RiskAgent, RiskAnalysis
from .execution_agent import ExecutionAgent, RebalanceProposal
from .research_agent import ResearchAgent, ResearchSignal, SignalSeverity

logger = logging.getLogger(__name__)


# Prometheus metrics
CYCLE_COUNTER = Counter('agent_cycles_total', 'Total monitoring cycles', ['status'])
RISK_SCORE = Gauge('vault_risk_score', 'Current vault risk score')
TVL_GAUGE = Gauge('vault_tvl_usd', 'Vault TVL in USD')
CYCLE_DURATION = Histogram('agent_cycle_duration_seconds', 'Cycle duration')
SIGNALS_COUNTER = Counter('research_signals_total', 'Research signals', ['severity'])
REBALANCE_COUNTER = Counter('rebalances_total', 'Rebalance operations', ['status'])


class AgentOrchestrator:
    """
    Orchestrates Risk, Execution, and Research agents
    """

    MONITORING_INTERVAL_MINUTES = 5
    MAX_RETRIES = 3
    RETRY_BACKOFF_BASE = 2

    def __init__(
        self,
        config: Dict[str, Any]
    ):
        self.config = config
        self.scheduler = AsyncIOScheduler()
        self.redis: Optional[redis.Redis] = None
        
        # Initialize agents
        self.risk_agent: Optional[RiskAgent] = None
        self.execution_agent: Optional[ExecutionAgent] = None
        self.research_agent: Optional[ResearchAgent] = None
        
        # Web3 connection
        self.w3 = Web3(Web3.HTTPProvider(config["web3_provider"]))
        
        # State tracking
        self.last_cycle_time: Optional[datetime] = None
        self.last_risk_analysis: Optional[RiskAnalysis] = None
        self.is_running = False

    async def initialize(self):
        """Initialize all agents and connections"""
        logger.info("Initializing Agent Orchestrator...")
        
        # Start Prometheus metrics server
        start_http_server(self.config.get("metrics_port", 9090))
        
        # Initialize Redis
        self.redis = redis.from_url(self.config["redis_url"])
        
        # Initialize Risk Agent
        self.risk_agent = RiskAgent(
            anthropic_api_key=self.config["anthropic_api_key"],
            web3_provider=self.config["web3_provider"],
            vault_address=self.config["vault_address"],
            vault_abi=self.config["vault_abi"],
            risk_oracle_address=self.config["risk_oracle_address"],
            risk_oracle_abi=self.config["risk_oracle_abi"],
            db_url=self.config["db_url"],
            private_key=self.config["private_key"]
        )
        await self.risk_agent.initialize()
        
        # Initialize Execution Agent
        self.execution_agent = ExecutionAgent(
            web3_provider=self.config["web3_provider"],
            vault_address=self.config["vault_address"],
            vault_abi=self.config["vault_abi"],
            db_url=self.config["db_url"],
            private_key=self.config["private_key"],
            flashbots_url=self.config.get("flashbots_url", "https://relay.flashbots.net")
        )
        await self.execution_agent.initialize()
        
        # Initialize Research Agent
        self.research_agent = ResearchAgent(
            anthropic_api_key=self.config["anthropic_api_key"],
            redis_url=self.config["redis_url"],
            discord_webhook_url=self.config.get("discord_webhook_url")
        )
        await self.research_agent.initialize()
        
        logger.info("All agents initialized successfully")

    async def start(self):
        """Start the orchestrator"""
        logger.info("Starting Agent Orchestrator...")
        
        # Schedule monitoring cycle
        self.scheduler.add_job(
            self._run_monitoring_cycle,
            IntervalTrigger(minutes=self.MONITORING_INTERVAL_MINUTES),
            id="monitoring_cycle",
            replace_existing=True
        )
        
        # Schedule research monitoring (less frequent)
        self.scheduler.add_job(
            self._run_research_cycle,
            IntervalTrigger(minutes=15),
            id="research_cycle",
            replace_existing=True
        )
        
        self.scheduler.start()
        self.is_running = True
        
        # Run initial cycle
        await self._run_monitoring_cycle()
        
        logger.info("Agent Orchestrator started")

    async def stop(self):
        """Stop the orchestrator"""
        logger.info("Stopping Agent Orchestrator...")
        
        self.is_running = False
        self.scheduler.shutdown(wait=True)
        
        # Clean up agents
        if self.risk_agent:
            await self.risk_agent.close()
        if self.execution_agent:
            await self.execution_agent.close()
        if self.research_agent:
            await self.research_agent.close()
        if self.redis:
            await self.redis.close()
        
        logger.info("Agent Orchestrator stopped")

    async def _run_monitoring_cycle(self):
        """Run a complete monitoring cycle"""
        start_time = datetime.utcnow()
        
        try:
            logger.info("Starting monitoring cycle...")
            
            # Fetch vault data
            vault_data = await self.risk_agent.fetch_vault_data()
            TVL_GAUGE.set(float(vault_data.tvl))
            
            # Check for pending research signals
            signals = await self._get_pending_research_signals()
            
            # Run risk analysis (includes research signals context)
            risk_analysis = await self._run_risk_analysis_with_retry(vault_data, signals)
            self.last_risk_analysis = risk_analysis
            
            RISK_SCORE.set(risk_analysis.composite_score)
            
            # Update risk oracle on-chain
            await self.risk_agent.update_risk_oracle(risk_analysis)
            
            # Publish to Redis for other services
            await self._publish_risk_update(risk_analysis)
            
            # Check if rebalancing is needed (only if risk is acceptable)
            if risk_analysis.risk_level not in ["HIGH_RISK", "CRITICAL"]:
                await self._check_and_execute_rebalance(risk_analysis)
            
            self.last_cycle_time = datetime.utcnow()
            duration = (self.last_cycle_time - start_time).total_seconds()
            
            CYCLE_DURATION.observe(duration)
            CYCLE_COUNTER.labels(status="success").inc()
            
            logger.info(f"Monitoring cycle completed in {duration:.2f}s. Risk: {risk_analysis.composite_score}")
            
        except Exception as e:
            CYCLE_COUNTER.labels(status="error").inc()
            logger.error(f"Monitoring cycle failed: {e}")

    async def _run_research_cycle(self):
        """Run research monitoring cycle"""
        try:
            logger.info("Starting research cycle...")
            
            signals = await self.research_agent.run_monitoring_cycle()
            
            for signal in signals:
                SIGNALS_COUNTER.labels(severity=signal.severity.value).inc()
            
            # If critical signals found, trigger immediate risk re-evaluation
            critical_signals = [s for s in signals if s.severity == SignalSeverity.CRITICAL]
            if critical_signals:
                logger.warning(f"Critical signals detected: {len(critical_signals)}")
                await self._run_monitoring_cycle()
            
            logger.info(f"Research cycle completed. {len(signals)} signals generated.")
            
        except Exception as e:
            logger.error(f"Research cycle failed: {e}")

    async def _run_risk_analysis_with_retry(
        self,
        vault_data,
        signals: list
    ) -> RiskAnalysis:
        """Run risk analysis with exponential backoff retry"""
        last_error = None
        
        for attempt in range(self.MAX_RETRIES):
            try:
                return await self.risk_agent.analyze_risk(vault_data)
            except Exception as e:
                last_error = e
                wait_time = self.RETRY_BACKOFF_BASE ** attempt
                logger.warning(f"Risk analysis attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s")
                await asyncio.sleep(wait_time)
        
        # Return conservative risk score on failure
        logger.error(f"Risk analysis failed after {self.MAX_RETRIES} attempts: {last_error}")
        
        return RiskAnalysis(
            timestamp=datetime.utcnow(),
            composite_score=7500,  # Conservative score
            protocol_risk=7500,
            liquidity_risk=7500,
            utilization_risk=7500,
            governance_risk=7500,
            oracle_risk=7500,
            risk_level="HIGH_RISK",
            recommended_action="Manual review required - analysis failed",
            action_urgency="HIGH",
            reasoning=f"Analysis failed: {str(last_error)}",
            strategy_risks={},
            alerts=["Risk analysis failure - conservative score applied"],
            should_emergency_unwind=False,
            unwind_strategies=[]
        )

    async def _get_pending_research_signals(self) -> list:
        """Get recent research signals for risk context"""
        try:
            return await self.research_agent.get_recent_signals(limit=20)
        except Exception as e:
            logger.error(f"Failed to fetch research signals: {e}")
            return []

    async def _publish_risk_update(self, analysis: RiskAnalysis):
        """Publish risk update to Redis pub/sub"""
        try:
            await self.redis.publish(
                "risk_updates",
                {
                    "timestamp": analysis.timestamp.isoformat(),
                    "composite_score": analysis.composite_score,
                    "risk_level": analysis.risk_level,
                    "alerts": analysis.alerts
                }
            )
            
            # Store latest analysis
            await self.redis.set(
                "latest_risk_analysis",
                {
                    "timestamp": analysis.timestamp.isoformat(),
                    "composite_score": analysis.composite_score,
                    "protocol_risk": analysis.protocol_risk,
                    "liquidity_risk": analysis.liquidity_risk,
                    "utilization_risk": analysis.utilization_risk,
                    "governance_risk": analysis.governance_risk,
                    "oracle_risk": analysis.oracle_risk,
                    "risk_level": analysis.risk_level,
                    "recommended_action": analysis.recommended_action
                }
            )
        except Exception as e:
            logger.error(f"Failed to publish risk update: {e}")

    async def _check_and_execute_rebalance(self, risk_analysis: RiskAnalysis):
        """Check if rebalancing is needed and execute if approved"""
        try:
            # Check cooldown
            can_rebalance, reason = await self.execution_agent.can_rebalance()
            if not can_rebalance:
                logger.debug(f"Rebalance skipped: {reason}")
                return
            
            # Propose rebalance
            proposal = await self.execution_agent.propose_rebalance()
            if not proposal:
                return
            
            logger.info(f"Rebalance proposed: {proposal.from_strategy} → {proposal.to_strategy}")
            
            # Submit proposal on-chain
            proposal_id = await self.execution_agent.submit_proposal_onchain(proposal)
            if not proposal_id:
                REBALANCE_COUNTER.labels(status="proposal_failed").inc()
                return
            
            # For now, auto-approve if risk is low (in production, would need manual approval)
            if risk_analysis.composite_score < 5000:
                # Execute immediately (Risk Agent would approve in real flow)
                success = await self.execution_agent.execute_approved_proposal(proposal_id)
                
                if success:
                    REBALANCE_COUNTER.labels(status="executed").inc()
                    logger.info(f"Rebalance executed successfully")
                else:
                    REBALANCE_COUNTER.labels(status="execution_failed").inc()
            else:
                REBALANCE_COUNTER.labels(status="pending_approval").inc()
                logger.info(f"Rebalance pending approval (risk too high)")
                
        except Exception as e:
            REBALANCE_COUNTER.labels(status="error").inc()
            logger.error(f"Rebalance check failed: {e}")

    async def get_status(self) -> Dict[str, Any]:
        """Get current orchestrator status"""
        return {
            "is_running": self.is_running,
            "last_cycle_time": self.last_cycle_time.isoformat() if self.last_cycle_time else None,
            "last_risk_score": self.last_risk_analysis.composite_score if self.last_risk_analysis else None,
            "last_risk_level": self.last_risk_analysis.risk_level if self.last_risk_analysis else None,
            "next_cycle_time": self.scheduler.get_job("monitoring_cycle").next_run_time.isoformat() if self.is_running else None
        }

    async def trigger_emergency_analysis(self):
        """Manually trigger emergency risk analysis"""
        logger.warning("Emergency analysis triggered manually")
        await self._run_monitoring_cycle()


async def main():
    """Main entry point"""
    import os
    from dotenv import load_dotenv
    
    load_dotenv()
    
    config = {
        "anthropic_api_key": os.getenv("ANTHROPIC_API_KEY"),
        "web3_provider": os.getenv("WEB3_PROVIDER", "https://eth.llamarpc.com"),
        "vault_address": os.getenv("VAULT_ADDRESS"),
        "vault_abi": [],  # Load from file
        "risk_oracle_address": os.getenv("RISK_ORACLE_ADDRESS"),
        "risk_oracle_abi": [],  # Load from file
        "db_url": os.getenv("DATABASE_URL"),
        "redis_url": os.getenv("REDIS_URL", "redis://localhost:6379"),
        "private_key": os.getenv("AGENT_PRIVATE_KEY"),
        "discord_webhook_url": os.getenv("DISCORD_WEBHOOK_URL"),
        "metrics_port": int(os.getenv("METRICS_PORT", "9090"))
    }
    
    orchestrator = AgentOrchestrator(config)
    await orchestrator.initialize()
    await orchestrator.start()
    
    # Keep running
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        await orchestrator.stop()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
