"""
PHASE 6 — Monitoring Dashboard: The Control Panel
Real-time API + web dashboard showing everything happening.

Endpoints:
  GET /api/status          — Full bot status
  GET /api/signals         — Recent signal history
  GET /api/trades          — Trade log
  GET /api/channels        — Individual channel scores
  GET /api/performance     — Win rate, PnL, equity curve
  GET /api/config          — Current configuration
  GET /                    — HTML dashboard
"""

import asyncio
import json
from datetime import datetime, timezone
from loguru import logger

try:
    from fastapi import FastAPI, Request
    from fastapi.responses import HTMLResponse, JSONResponse
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn

    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False
    logger.warning("⚠️  FastAPI not installed — dashboard unavailable")


class MonitoringDashboard:
    """Real-time monitoring dashboard for the BTC 15m bot."""

    def __init__(self, config, strategy=None, pipeline=None, executor=None):
        self.config = config
        self.strategy = strategy
        self.pipeline = pipeline
        self.executor = executor
        self.app = None
        self._signal_history = []
        self._max_history = 500

        if FASTAPI_AVAILABLE:
            self._build_app()

    def _build_app(self):
        """Create FastAPI application with all endpoints."""
        self.app = FastAPI(title="Nexxore BTC 15m Bot", version="1.0.0")

        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )

        @self.app.get("/api/status")
        async def get_status():
            strategy_stats = self.strategy.get_stats() if self.strategy else {}
            executor_status = self.executor.get_status() if self.executor else {}

            return {
                "bot": "Nexxore BTC 15m Bot",
                "mode": self.config.MODE,
                "uptime": datetime.now(timezone.utc).isoformat(),
                "strategy": strategy_stats,
                "executor": executor_status,
                "signal_count": len(self._signal_history),
            }

        @self.app.get("/api/signals")
        async def get_signals():
            return {"signals": self._signal_history[-50:]}

        @self.app.get("/api/trades")
        async def get_trades():
            trades = self.executor.get_trade_history() if self.executor else []
            return {"trades": trades}

        @self.app.get("/api/channels")
        async def get_channels():
            if self._signal_history:
                latest = self._signal_history[-1]
                return {"channels": latest.get("channels", {})}
            return {"channels": {}}

        @self.app.get("/api/performance")
        async def get_performance():
            if not self.strategy:
                return {"error": "no strategy"}
            stats = self.strategy.get_stats()
            return {
                "win_rate": stats["win_rate"],
                "total_pnl": stats["total_pnl"],
                "capital": stats["capital"],
                "drawdown": stats["drawdown"],
                "total_trades": stats["total_trades"],
                "daily_pnl": stats["daily_pnl"],
                "equity_curve": [t.get("capital_after", stats["capital"]) for t in self.strategy.trade_log[-100:]],
            }

        @self.app.get("/api/config")
        async def get_config():
            return {
                "mode": self.config.MODE,
                "signal_threshold": self.config.SIGNAL_THRESHOLD,
                "max_position_size": self.config.MAX_POSITION_SIZE_USD,
                "max_daily_trades": self.config.MAX_DAILY_TRADES,
                "max_daily_loss": self.config.MAX_DAILY_LOSS_USD,
                "candle_interval": self.config.CANDLE_INTERVAL,
                "scan_interval": self.config.SCAN_INTERVAL_SECONDS,
                "channel_weights": self.config.CHANNEL_WEIGHTS,
            }

        @self.app.get("/", response_class=HTMLResponse)
        async def dashboard():
            return self._render_dashboard()

    def record_signal(self, signal: dict):
        """Record a signal for history."""
        self._signal_history.append(signal)
        if len(self._signal_history) > self._max_history:
            self._signal_history = self._signal_history[-self._max_history:]

    async def start(self):
        """Start the dashboard server."""
        if not FASTAPI_AVAILABLE or not self.app:
            logger.warning("Dashboard unavailable — FastAPI not installed")
            return

        config = uvicorn.Config(
            self.app,
            host=self.config.DASHBOARD_HOST,
            port=self.config.DASHBOARD_PORT,
            log_level="warning",
        )
        server = uvicorn.Server(config)
        logger.info(f"📊 Dashboard running at http://localhost:{self.config.DASHBOARD_PORT}")
        await server.serve()

    def _render_dashboard(self) -> str:
        """Render the HTML dashboard."""
        stats = self.strategy.get_stats() if self.strategy else {}
        exec_status = self.executor.get_status() if self.executor else {}

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nexxore BTC 15m Bot</title>
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ background:#05050D; color:#E8E8F0; font-family:'Inter',system-ui,sans-serif; padding:24px; }}
  .header {{ display:flex; justify-content:space-between; align-items:center; margin-bottom:32px; }}
  .header h1 {{ font-family:'Space Grotesk',sans-serif; font-size:28px; background:linear-gradient(135deg,#00C8FF,#6B4FE8); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }}
  .mode {{ padding:6px 16px; border-radius:20px; font-size:13px; font-weight:600; }}
  .mode.paper {{ background:rgba(232,160,32,0.15); color:#E8A020; border:1px solid rgba(232,160,32,0.3); }}
  .mode.live {{ background:rgba(0,232,122,0.15); color:#00E87A; border:1px solid rgba(0,232,122,0.3); }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; margin-bottom:24px; }}
  .card {{ background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:12px; padding:20px; }}
  .card h3 {{ font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#888; margin-bottom:12px; }}
  .card .value {{ font-family:'IBM Plex Mono',monospace; font-size:28px; font-weight:700; }}
  .positive {{ color:#00E87A; }}
  .negative {{ color:#FF3D5A; }}
  .neutral {{ color:#E8A020; }}
  .channel-bar {{ display:flex; align-items:center; gap:12px; margin:8px 0; }}
  .channel-bar .name {{ width:140px; font-size:13px; color:#999; }}
  .channel-bar .bar {{ flex:1; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden; }}
  .channel-bar .fill {{ height:100%; border-radius:4px; transition:width 0.5s ease; }}
  .signal-log {{ max-height:400px; overflow-y:auto; }}
  .signal-row {{ display:flex; justify-content:space-between; padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.04); font-family:'IBM Plex Mono',monospace; font-size:13px; }}
  .long {{ color:#00E87A; }}
  .short {{ color:#FF3D5A; }}
  #refreshTimer {{ font-size:12px; color:#666; }}
</style>
</head>
<body>
<div class="header">
  <h1>⚡ Nexxore BTC 15m Bot</h1>
  <div>
    <span class="mode {'paper' if exec_status.get('mode') == 'paper' else 'live'}">{exec_status.get('mode','paper').upper()}</span>
    <span id="refreshTimer"></span>
  </div>
</div>

<div class="grid">
  <div class="card">
    <h3>Capital</h3>
    <div class="value">${stats.get('capital', self.config.INITIAL_CAPITAL):,.2f}</div>
  </div>
  <div class="card">
    <h3>Total P&L</h3>
    <div class="value {'positive' if stats.get('total_pnl',0) >= 0 else 'negative'}">${stats.get('total_pnl', 0):+,.2f}</div>
  </div>
  <div class="card">
    <h3>Win Rate</h3>
    <div class="value">{stats.get('win_rate', 0)*100:.1f}%</div>
  </div>
  <div class="card">
    <h3>Trades Today</h3>
    <div class="value">{stats.get('daily_trades', 0)}</div>
  </div>
  <div class="card">
    <h3>Drawdown</h3>
    <div class="value {'negative' if stats.get('drawdown',0) > 5 else 'neutral'}">{stats.get('drawdown', 0):.1f}%</div>
  </div>
  <div class="card">
    <h3>Position</h3>
    <div class="value {'long' if stats.get('position') and stats['position'].get('direction')=='long' else ('short' if stats.get('position') else 'neutral')}">{stats.get('position',{}).get('direction','None').upper() if stats.get('position') else 'FLAT'}</div>
  </div>
</div>

<div class="grid">
  <div class="card" style="grid-column:span 2;">
    <h3>Channel Scores</h3>
    <div id="channels">
      <div class="channel-bar"><span class="name">Liquidity & Whale</span><div class="bar"><div class="fill" style="width:50%;background:#00C8FF;" id="ch-lw"></div></div><span id="ch-lw-val">--</span></div>
      <div class="channel-bar"><span class="name">Macro Sentiment</span><div class="bar"><div class="fill" style="width:50%;background:#6B4FE8;" id="ch-ms"></div></div><span id="ch-ms-val">--</span></div>
      <div class="channel-bar"><span class="name">Supply & Demand</span><div class="bar"><div class="fill" style="width:50%;background:#00E87A;" id="ch-sd"></div></div><span id="ch-sd-val">--</span></div>
      <div class="channel-bar"><span class="name">Derivatives</span><div class="bar"><div class="fill" style="width:50%;background:#E8A020;" id="ch-dv"></div></div><span id="ch-dv-val">--</span></div>
    </div>
  </div>
  <div class="card">
    <h3>Signal Composite</h3>
    <div class="value" id="composite" style="font-size:48px;">--</div>
    <div id="direction" style="margin-top:8px;font-size:14px;">Waiting...</div>
  </div>
</div>

<div class="card" style="margin-top:16px;">
  <h3>Recent Signals</h3>
  <div class="signal-log" id="signalLog">
    <div class="signal-row" style="color:#666;">Loading...</div>
  </div>
</div>

<script>
async function refresh() {{
  try {{
    const [status, channels, signals] = await Promise.all([
      fetch('/api/status').then(r=>r.json()),
      fetch('/api/channels').then(r=>r.json()),
      fetch('/api/signals').then(r=>r.json()),
    ]);

    // Update channels
    const ch = channels.channels || {{}};
    const map = {{
      'liquidity_whale': ['ch-lw', 'ch-lw-val'],
      'macro_sentiment': ['ch-ms', 'ch-ms-val'],
      'supply_demand': ['ch-sd', 'ch-sd-val'],
      'derivatives': ['ch-dv', 'ch-dv-val'],
    }};
    for (const [key, [barId, valId]] of Object.entries(map)) {{
      const score = ch[key]?.score ?? 50;
      const el = document.getElementById(barId);
      const valEl = document.getElementById(valId);
      if (el) el.style.width = score + '%';
      if (valEl) valEl.textContent = score.toFixed(0);
    }}

    // Update composite
    const sigs = signals.signals || [];
    if (sigs.length > 0) {{
      const latest = sigs[sigs.length - 1];
      document.getElementById('composite').textContent = latest.composite_score?.toFixed(1) ?? '--';
      const dirEl = document.getElementById('direction');
      dirEl.textContent = (latest.direction || 'neutral').toUpperCase();
      dirEl.className = latest.direction || '';
    }}

    // Update signal log
    const logEl = document.getElementById('signalLog');
    logEl.innerHTML = sigs.slice(-20).reverse().map(s => {{
      const time = new Date(s.timestamp).toLocaleTimeString();
      const dir = s.direction || 'neutral';
      return `<div class="signal-row"><span>${{time}}</span><span class="${{dir}}">${{dir.toUpperCase()}}</span><span>${{s.composite_score?.toFixed(1)}}</span></div>`;
    }}).join('');

  }} catch(e) {{ console.error('Refresh error:', e); }}
}}
refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>"""
