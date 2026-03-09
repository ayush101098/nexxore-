"""
Nexxore Signal Engine - WebSocket Live Feed
=============================================
Real-time WebSocket broadcasting of signal events, top movers,
and market state changes.

Endpoint: ws://host:port/ws/signals/live
"""

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Set

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ..config import engine_config
from ..models import SignalEvent
from ..scoring.scorer import scorer

logger = logging.getLogger("nexxore.signal-engine.websocket")


class SignalWebSocketManager:
    """Manages WebSocket connections and broadcasts signal events.
    
    Features:
    - Auto-heartbeat to keep connections alive
    - Periodic broadcast of top signals summary
    - Real-time push on signal_generated events
    - Graceful disconnect handling
    """
    
    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._event_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._running = False
        self._broadcast_count = 0
    
    async def connect(self, websocket: WebSocket):
        """Accept a new WebSocket connection."""
        if len(self._connections) >= engine_config.websocket.max_connections:
            await websocket.close(code=1013, reason="Max connections reached")
            return False
        
        await websocket.accept()
        self._connections.add(websocket)
        
        # Send welcome message
        await self._send_json(websocket, {
            "type": "connected",
            "message": "Nexxore Signal Engine - Live Feed",
            "timestamp": time.time(),
        })
        
        logger.info(f"WebSocket connected. Active: {len(self._connections)}")
        return True
    
    def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection."""
        self._connections.discard(websocket)
        logger.info(f"WebSocket disconnected. Active: {len(self._connections)}")
    
    async def _send_json(self, ws: WebSocket, data: Dict[str, Any]):
        """Send JSON to a single WebSocket, handling errors."""
        try:
            if ws.client_state == WebSocketState.CONNECTED:
                await ws.send_json(data)
        except Exception:
            self._connections.discard(ws)
    
    async def broadcast(self, data: Dict[str, Any]):
        """Broadcast to all connected WebSockets."""
        if not self._connections:
            return
        
        dead = set()
        for ws in self._connections:
            try:
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_json(data)
                else:
                    dead.add(ws)
            except Exception:
                dead.add(ws)
        
        self._connections -= dead
        self._broadcast_count += 1
    
    async def on_signal_event(self, event: SignalEvent):
        """Called by scorer when a signal is generated."""
        try:
            self._event_queue.put_nowait(event)
        except asyncio.QueueFull:
            pass  # Drop oldest events if queue is full
    
    async def _broadcast_loop(self):
        """Periodically broadcast top signals summary."""
        while self._running:
            try:
                if self._connections:
                    # Get current top signals
                    top = scorer.get_top_signals(limit=10, min_score=10)
                    strong = scorer.get_strong_trades(limit=5)
                    
                    await self.broadcast({
                        "type": "signals_update",
                        "top_signals": [t.to_dict() for t in top],
                        "strong_trades": [t.to_dict() for t in strong],
                        "stats": scorer.get_stats(),
                        "timestamp": time.time(),
                    })
                
                await asyncio.sleep(engine_config.websocket.broadcast_interval)
                
            except Exception as e:
                logger.error(f"Broadcast loop error: {e}")
                await asyncio.sleep(1)
    
    async def _event_loop(self):
        """Process and broadcast signal events from the queue."""
        while self._running:
            try:
                event = await asyncio.wait_for(
                    self._event_queue.get(), timeout=1.0
                )
                await self.broadcast({
                    "type": "signal_event",
                    "data": event.to_dict(),
                    "timestamp": time.time(),
                })
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Event loop error: {e}")
    
    async def _heartbeat_loop(self):
        """Send periodic heartbeats to keep connections alive."""
        while self._running:
            try:
                if self._connections:
                    await self.broadcast({
                        "type": "heartbeat",
                        "timestamp": time.time(),
                        "connections": len(self._connections),
                    })
                await asyncio.sleep(engine_config.websocket.heartbeat_interval)
            except Exception:
                await asyncio.sleep(5)
    
    async def start(self):
        """Start background broadcast and event processing loops."""
        self._running = True
        
        # Register as signal event subscriber
        scorer.subscribe_events(self.on_signal_event)
        
        # Start background tasks
        asyncio.create_task(self._broadcast_loop())
        asyncio.create_task(self._event_loop())
        asyncio.create_task(self._heartbeat_loop())
        
        logger.info("WebSocket manager started")
    
    async def stop(self):
        """Stop all background loops."""
        self._running = False
        
        # Close all connections
        for ws in list(self._connections):
            try:
                await ws.close()
            except Exception:
                pass
        self._connections.clear()
    
    def get_stats(self) -> Dict[str, Any]:
        return {
            "active_connections": len(self._connections),
            "broadcast_count": self._broadcast_count,
            "event_queue_size": self._event_queue.qsize(),
            "running": self._running,
        }


# Global WebSocket manager
ws_manager = SignalWebSocketManager()
