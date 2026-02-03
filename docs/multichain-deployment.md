# Multichain Deployment Plan

## Target Chains
- **Ethereum** (mainnet)
- **Arbitrum One**
- **Base**
- **Solana**
- **Hyperliquid** (perps execution)

## Wallet Support
- MetaMask (EVM)
- WalletConnect (EVM)
- Solana wallets (Phantom/Solflare) — add when Solana UI goes live

## Execution Architecture
- **Perps**: Hyperliquid for live execution
- **Vaults/Strategies**: EVM contracts (Ethereum/Arbitrum/Base), Solana programs
- **Routing**: Chain adapters per network + unified API
- **Perps Infra**: Dedicated perps service with WebSocket orderbook/trades + risk engine

## Environment Configuration
Set these for each deployment:

```
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Hyperliquid
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz

# EVM RPCs
ETHEREUM_RPC=
ARBITRUM_RPC=
BASE_RPC=

# Solana RPC
SOLANA_RPC=

# Perps service
PERPS_PORT=3010
PERPS_MARKET_WS=wss://stream.binance.com:9443/stream
PERPS_MARKETS=btcusdt,ethusdt,solusdt
PERPS_MAINT_MARGIN=0.005
PERPS_MAX_LEVERAGE=50
PERPS_MAKER_FEE=0.0002
PERPS_TAKER_FEE=0.0006
```

## Deployment Checklist
1. **Contracts**
   - Deploy nUSD, VaultFactory, StrategyRouter on Ethereum
   - Deploy vault instances on Arbitrum/Base
   - Deploy Solana vault program + accounts

2. **Backend**
   - Configure chain adapters for EVM + Solana
   - Enable Hyperliquid signing + execution router
   - Run perps service for live orderbook/trades + positions (ws://<host>/ws/perps)

3. **Frontend**
   - EVM wallet connect (MetaMask + WalletConnect)
   - Solana wallet connect (Phantom/Solflare) for Solana UI
   - Chain selector + network gating per feature

4. **Data**
   - Supabase schema for trades/positions
   - Indexer jobs for chain data

## Next Steps
- Add Solana wallet connect and UI gating
- Add chain selector on perps + vaults pages
- Extend API to route trades to target chain adapters
