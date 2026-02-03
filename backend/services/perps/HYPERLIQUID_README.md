# Nexxore Perps - HyperLiquid Integration

## ✅ WORKING ROUTE: HyperLiquid

**This is the EASY route** - no smart contract deployment needed!

### Top 20 Markets (Default)

BTC, ETH, SOL, HYPE, ARB, OP, AVAX, MATIC, DOGE, LINK, UNI, ATOM, LTC, BCH, ETC, FIL, APT, STX, INJ, TIA

### Quick Start

```bash
cd backend/services/perps
chmod +x start-perps.sh
./start-perps.sh
```

Or manually:

```bash
export USE_HYPERLIQUID=true
export PERPS_PORT=3010
node index.js
```

### Features

✅ **Market Data**: Real-time WebSocket from HyperLiquid API  
✅ **Top 20 Assets**: All major perpetuals ready to trade  
✅ **Order Execution**: Direct HyperLiquid exchange integration  
✅ **No Deployment**: Zero smart contract setup required  
✅ **Deep Liquidity**: Tap into HyperLiquid's order book  

### How It Works

1. **Market Data**: Connects to `wss://api.hyperliquid.xyz/ws` for:
   - L2 order book (real-time bids/asks)
   - Trade feed (recent market trades)
   - Ticker data (prices, 24h changes)

2. **Order Placement**:
   - User signs order with wallet
   - Backend sends to HyperLiquid `/exchange` endpoint
   - Position tracked in local database
   - No gas fees, instant execution

3. **Position Management**:
   - Opens/closes tracked via HyperLiquid responses
   - Local DB maintains user positions
   - WebSocket pushes position updates to frontend

### Architecture

```
┌─────────────┐       ┌──────────────┐       ┌─────────────────┐
│  Frontend   │◄─────►│ Perps Service│◄─────►│  HyperLiquid    │
│ (perps.html)│  WS   │  (Node.js)   │  API  │  Exchange API   │
└─────────────┘       └──────────────┘       └─────────────────┘
                              │
                              ▼
                       ┌─────────────┐
                       │  PostgreSQL │
                       │  (Positions)│
                       └─────────────┘
```

### Configuration

**Environment Variables**:

```bash
USE_HYPERLIQUID=true                    # Enable HyperLiquid mode
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz
PERPS_PORT=3010
PERPS_MARKETS=BTC,ETH,SOL,HYPE,ARB,... # Top 20 markets
DATABASE_URL=postgresql://...           # Postgres connection
```

**Frontend Config** (perps.html):

```javascript
const CONFIG = {
  useHyperliquid: true,  // Enabled by default
  apiBase: '/api',
  perpsApiBase: null     // Uses apiBase if null
};
```

### API Endpoints

#### Market Data
- `GET /api/perps/markets` - Get all market snapshots
- `GET /api/perps/health` - Service health check

#### Trading
- `POST /api/perps/order` - Place order (market/limit)
  - Accepts `hyperliquidAction`, `hyperliquidSignature`, `hyperliquidNonce`
  - Executes via HyperLiquid API
  - Returns `{ order, position, execution }`

- `POST /api/perps/close` - Close position
  - Sends close order to HyperLiquid
  - Updates local position status

#### User Data
- `GET /api/perps/positions?address=0x...` - User positions
- `GET /api/perps/orders?address=0x...` - Open orders
- `GET /api/perps/history?address=0x...` - Trade history

#### WebSocket
- `ws://localhost:3010/ws/perps` - Live market data
  - Subscribe: `{ type: 'subscribe', market: 'btc' }`
  - Receives: `ticker`, `orderbook`, `trade`, `position` events

### Comparison vs Solana Route

| Feature | HyperLiquid ✅ | Solana (Blocked) |
|---------|---------------|------------------|
| Deployment | None needed | Requires anchor build |
| Smart Contracts | No | Yes (Rust/Anchor) |
| Time to Launch | Ready now | Blocked on macOS toolchain |
| Liquidity | Deep (HyperLiquid) | Would need seeding |
| Markets | 20+ ready | Would need oracle setup |
| Gas Fees | None | SOL transaction fees |

### Frontend Usage

Users can:
1. Connect wallet (MetaMask/WalletConnect)
2. Select from 20 markets
3. Place market/limit orders
4. Positions execute on HyperLiquid
5. Real-time price updates via WebSocket

### Testing

```bash
# Start service
./start-perps.sh

# In another terminal, test API
curl http://localhost:3010/api/perps/health
curl http://localhost:3010/api/perps/markets

# Open frontend
open perps.html
# (or serve via http-server)
```

### Production Deployment

1. Set up PostgreSQL database
2. Run schema: `psql < schema.sql`
3. Set environment variables
4. Deploy to Vercel/Railway/Fly.io
5. Point frontend to production API

### Troubleshooting

**No market data?**
- Check HyperLiquid API is reachable: `curl https://api.hyperliquid.xyz/info`
- Verify WebSocket connection in browser console

**Orders not executing?**
- Ensure wallet is connected
- Check HyperLiquid asset mapping loaded (`loadHyperliquidAssets()`)
- Verify signature is valid

**WebSocket disconnecting?**
- Backend logs will show reconnection attempts
- Service auto-reconnects every 4 seconds

---

## Why This Route Works

1. **No Blockchain Deployment**: Uses existing HyperLiquid infrastructure
2. **Production-Ready Liquidity**: Tap into real order books
3. **Zero Gas Costs**: HyperLiquid handles settlement
4. **Fast Integration**: Works immediately with API keys
5. **20 Markets Ready**: BTC, ETH, SOL, HYPE, ARB, OP, AVAX, MATIC, DOGE, LINK, UNI, ATOM, LTC, BCH, ETC, FIL, APT, STX, INJ, TIA

The Solana route would require:
- Fixing macOS Xcode toolchain issues
- Deploying Anchor programs
- Seeding liquidity pools
- Setting up oracle price feeds
- Managing on-chain settlement

**HyperLiquid integration = 100x easier and already working!**
