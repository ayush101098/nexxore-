"""
Blockchain Event Listener Service
Listens to vault and strategy events and updates database
"""

import asyncio
import json
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List, Callable

import asyncpg
from web3 import Web3
from web3.contract import Contract
import websockets

logger = logging.getLogger(__name__)


class EventListener:
    """
    Listens to blockchain events via WebSocket and processes them
    """

    def __init__(
        self,
        ws_provider: str,
        vault_address: str,
        vault_abi: List[Dict],
        strategy_addresses: List[str],
        strategy_abi: List[Dict],
        db_url: str,
        callback: Optional[Callable] = None
    ):
        self.ws_provider = ws_provider
        self.vault_address = Web3.to_checksum_address(vault_address)
        self.vault_abi = vault_abi
        self.strategy_addresses = [Web3.to_checksum_address(a) for a in strategy_addresses]
        self.strategy_abi = strategy_abi
        self.db_url = db_url
        self.callback = callback  # Called on critical events
        
        self.w3: Optional[Web3] = None
        self.vault: Optional[Contract] = None
        self.db_pool: Optional[asyncpg.Pool] = None
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.is_running = False
        self.subscriptions: Dict[str, str] = {}
        
        # WebSocket clients for real-time updates
        self.frontend_clients: List[websockets.WebSocketServerProtocol] = []

    async def initialize(self):
        """Initialize connections"""
        # HTTP provider for contract calls
        self.w3 = Web3(Web3.HTTPProvider(self.ws_provider.replace("wss://", "https://").replace("ws://", "http://")))
        
        self.vault = self.w3.eth.contract(
            address=self.vault_address,
            abi=self.vault_abi
        )
        
        # Database connection
        self.db_pool = await asyncpg.create_pool(self.db_url)
        await self._ensure_tables()

    async def _ensure_tables(self):
        """Create event tables if they don't exist"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS vault_events (
                    id SERIAL PRIMARY KEY,
                    event_type VARCHAR(50) NOT NULL,
                    block_number BIGINT NOT NULL,
                    tx_hash VARCHAR(66) NOT NULL,
                    log_index INT NOT NULL,
                    timestamp TIMESTAMPTZ DEFAULT NOW(),
                    address VARCHAR(42) NOT NULL,
                    args JSONB,
                    processed BOOLEAN DEFAULT FALSE,
                    UNIQUE(tx_hash, log_index)
                );
                
                CREATE INDEX IF NOT EXISTS idx_vault_events_type ON vault_events(event_type);
                CREATE INDEX IF NOT EXISTS idx_vault_events_block ON vault_events(block_number);
                CREATE INDEX IF NOT EXISTS idx_vault_events_timestamp ON vault_events(timestamp);
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS user_positions (
                    id SERIAL PRIMARY KEY,
                    user_address VARCHAR(42) NOT NULL,
                    shares DECIMAL NOT NULL DEFAULT 0,
                    total_deposited DECIMAL NOT NULL DEFAULT 0,
                    total_withdrawn DECIMAL NOT NULL DEFAULT 0,
                    last_action_time TIMESTAMPTZ,
                    last_action_tx VARCHAR(66),
                    UNIQUE(user_address)
                );
                
                CREATE INDEX IF NOT EXISTS idx_user_positions_address ON user_positions(user_address);
            """)

    async def start(self):
        """Start listening to events"""
        self.is_running = True
        
        # Start WebSocket listener
        asyncio.create_task(self._websocket_listener())
        
        # Start frontend WebSocket server
        asyncio.create_task(self._start_frontend_server())
        
        logger.info("Event listener started")

    async def stop(self):
        """Stop the listener"""
        self.is_running = False
        
        if self.ws:
            await self.ws.close()
        
        if self.db_pool:
            await self.db_pool.close()
        
        logger.info("Event listener stopped")

    async def _websocket_listener(self):
        """Main WebSocket listener loop"""
        while self.is_running:
            try:
                async with websockets.connect(self.ws_provider) as ws:
                    self.ws = ws
                    
                    # Subscribe to vault events
                    await self._subscribe_to_events(ws)
                    
                    # Listen for events
                    async for message in ws:
                        await self._handle_message(json.loads(message))
                        
            except websockets.ConnectionClosed:
                logger.warning("WebSocket disconnected, reconnecting...")
                await asyncio.sleep(5)
            except Exception as e:
                logger.error(f"WebSocket error: {e}")
                await asyncio.sleep(10)

    async def _subscribe_to_events(self, ws):
        """Subscribe to relevant events"""
        # Vault events
        vault_events = [
            "Deposit", "Withdraw", "RebalanceProposed", "RebalanceExecuted",
            "RiskScoreUpdated", "EmergencyUnwind", "StrategyAdded", "StrategyRemoved"
        ]
        
        for event_name in vault_events:
            try:
                event = getattr(self.vault.events, event_name)
                filter_params = event.build_filter().filter_params
                
                subscription = {
                    "jsonrpc": "2.0",
                    "id": f"sub_{event_name}",
                    "method": "eth_subscribe",
                    "params": ["logs", {
                        "address": self.vault_address,
                        "topics": filter_params.get("topics", [])
                    }]
                }
                
                await ws.send(json.dumps(subscription))
                response = json.loads(await ws.recv())
                
                if "result" in response:
                    self.subscriptions[response["result"]] = event_name
                    logger.info(f"Subscribed to {event_name}")
                    
            except Exception as e:
                logger.error(f"Failed to subscribe to {event_name}: {e}")

        # Strategy events
        for strategy_addr in self.strategy_addresses:
            subscription = {
                "jsonrpc": "2.0",
                "id": f"sub_strategy_{strategy_addr}",
                "method": "eth_subscribe",
                "params": ["logs", {"address": strategy_addr}]
            }
            
            await ws.send(json.dumps(subscription))
            response = json.loads(await ws.recv())
            
            if "result" in response:
                self.subscriptions[response["result"]] = f"strategy_{strategy_addr}"
                logger.info(f"Subscribed to strategy {strategy_addr}")

    async def _handle_message(self, message: Dict):
        """Handle incoming WebSocket message"""
        if "params" not in message:
            return
        
        subscription_id = message["params"].get("subscription")
        log_data = message["params"].get("result")
        
        if not subscription_id or not log_data:
            return
        
        event_type = self.subscriptions.get(subscription_id, "unknown")
        
        # Parse the log
        try:
            event = await self._parse_log(log_data, event_type)
            
            if event:
                # Store in database
                await self._store_event(event)
                
                # Update user positions for Deposit/Withdraw
                if event["event_type"] in ["Deposit", "Withdraw"]:
                    await self._update_user_position(event)
                
                # Broadcast to frontend clients
                await self._broadcast_to_frontend(event)
                
                # Trigger callback for critical events
                if event["event_type"] in ["EmergencyUnwind", "RiskScoreUpdated"]:
                    if self.callback:
                        await self.callback(event)
                
                logger.info(f"Processed event: {event['event_type']} at block {event['block_number']}")
                
        except Exception as e:
            logger.error(f"Failed to process log: {e}")

    async def _parse_log(self, log_data: Dict, event_hint: str) -> Optional[Dict]:
        """Parse raw log data into event dict"""
        try:
            topics = log_data.get("topics", [])
            data = log_data.get("data", "0x")
            
            # Decode based on ABI
            for event in self.vault.events:
                try:
                    decoded = event().process_log({
                        "topics": topics,
                        "data": data,
                        "address": log_data.get("address"),
                        "blockNumber": int(log_data.get("blockNumber", "0"), 16),
                        "transactionHash": log_data.get("transactionHash"),
                        "logIndex": int(log_data.get("logIndex", "0"), 16)
                    })
                    
                    return {
                        "event_type": decoded.event,
                        "block_number": decoded.blockNumber,
                        "tx_hash": decoded.transactionHash.hex() if decoded.transactionHash else None,
                        "log_index": decoded.logIndex,
                        "address": decoded.address,
                        "args": {k: str(v) if isinstance(v, (int, bytes)) else v for k, v in decoded.args.items()}
                    }
                except:
                    continue
                    
        except Exception as e:
            logger.debug(f"Log parse failed: {e}")
        
        return None

    async def _store_event(self, event: Dict):
        """Store event in database"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO vault_events (event_type, block_number, tx_hash, log_index, address, args)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (tx_hash, log_index) DO NOTHING
            """,
                event["event_type"],
                event["block_number"],
                event["tx_hash"],
                event["log_index"],
                event["address"],
                json.dumps(event["args"])
            )

    async def _update_user_position(self, event: Dict):
        """Update user position based on deposit/withdraw event"""
        args = event["args"]
        
        if event["event_type"] == "Deposit":
            user = args.get("sender") or args.get("owner")
            assets = int(args.get("assets", 0))
            shares = int(args.get("shares", 0))
            
            async with self.db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO user_positions (user_address, shares, total_deposited, last_action_time, last_action_tx)
                    VALUES ($1, $2, $3, NOW(), $4)
                    ON CONFLICT (user_address) DO UPDATE SET
                        shares = user_positions.shares + $2,
                        total_deposited = user_positions.total_deposited + $3,
                        last_action_time = NOW(),
                        last_action_tx = $4
                """,
                    user,
                    shares / 10**6,  # Convert from wei
                    assets / 10**6,
                    event["tx_hash"]
                )
                
        elif event["event_type"] == "Withdraw":
            user = args.get("sender") or args.get("owner")
            assets = int(args.get("assets", 0))
            shares = int(args.get("shares", 0))
            
            async with self.db_pool.acquire() as conn:
                await conn.execute("""
                    UPDATE user_positions SET
                        shares = shares - $2,
                        total_withdrawn = total_withdrawn + $3,
                        last_action_time = NOW(),
                        last_action_tx = $4
                    WHERE user_address = $1
                """,
                    user,
                    shares / 10**6,
                    assets / 10**6,
                    event["tx_hash"]
                )

    async def _broadcast_to_frontend(self, event: Dict):
        """Broadcast event to connected frontend clients"""
        message = json.dumps({
            "type": "vault_event",
            "data": event,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        disconnected = []
        for client in self.frontend_clients:
            try:
                await client.send(message)
            except:
                disconnected.append(client)
        
        # Remove disconnected clients
        for client in disconnected:
            self.frontend_clients.remove(client)

    async def _start_frontend_server(self):
        """Start WebSocket server for frontend connections"""
        async def handler(websocket, path):
            self.frontend_clients.append(websocket)
            logger.info(f"Frontend client connected. Total: {len(self.frontend_clients)}")
            
            try:
                async for message in websocket:
                    # Handle client messages if needed
                    pass
            finally:
                if websocket in self.frontend_clients:
                    self.frontend_clients.remove(websocket)
                logger.info(f"Frontend client disconnected. Total: {len(self.frontend_clients)}")
        
        server = await websockets.serve(handler, "0.0.0.0", 8765)
        logger.info("Frontend WebSocket server started on port 8765")
        
        await server.wait_closed()

    async def get_recent_events(
        self,
        event_type: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict]:
        """Get recent events from database"""
        async with self.db_pool.acquire() as conn:
            if event_type:
                rows = await conn.fetch("""
                    SELECT * FROM vault_events
                    WHERE event_type = $1
                    ORDER BY timestamp DESC
                    LIMIT $2
                """, event_type, limit)
            else:
                rows = await conn.fetch("""
                    SELECT * FROM vault_events
                    ORDER BY timestamp DESC
                    LIMIT $1
                """, limit)
            
            return [dict(row) for row in rows]

    async def get_user_position(self, address: str) -> Optional[Dict]:
        """Get user position from database"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM user_positions
                WHERE user_address = $1
            """, address.lower())
            
            return dict(row) if row else None


async def main():
    """Main entry point for testing"""
    import os
    from dotenv import load_dotenv
    
    load_dotenv()
    
    listener = EventListener(
        ws_provider=os.getenv("WS_PROVIDER", "wss://eth-mainnet.g.alchemy.com/v2/your-key"),
        vault_address=os.getenv("VAULT_ADDRESS"),
        vault_abi=[],  # Load from file
        strategy_addresses=[],
        strategy_abi=[],
        db_url=os.getenv("DATABASE_URL")
    )
    
    await listener.initialize()
    await listener.start()
    
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        await listener.stop()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
