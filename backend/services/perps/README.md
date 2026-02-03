# Perps Service# Perps Service


























Set DATABASE_URL and optional PERPS_PORT, PERPS_MARKETS, PERPS_MARKET_WS.## Environment- Subscribe payload: {"type":"subscribe","market":"btcusdt"}- ws://<host>/ws/perps## WebSocket- GET /api/perps/alerts?address=- GET /api/perps/history?address=- GET /api/perps/positions?address=- POST /api/perps/close- POST /api/perps/order- GET /api/perps/markets- GET /api/perps/health## Endpoints- Alert generation- Risk/margin checks + liquidation monitor- Position store + trade history- Execution router (CLOB + AMM hybrid)- WebSocket market data streaming (orderbook + trades + ticker)## FeaturesProvides live market data streams, execution routing, risk checks, and position management for Nexxore perps.
Provides live market data streams, execution routing, risk checks, and position management for Nexxore perps.

## Features
- WebSocket market data streaming (orderbook + trades + ticker)
- Execution router (CLOB + AMM hybrid)
- Position store + trade history
- Risk/margin checks + liquidation monitor
- Alert generation
- Orderbook write-back for limit orders
- Maker/taker fee accounting
- Per-chain settlement adapters (EVM + Solana)

## Endpoints
- GET /api/perps/health
- GET /api/perps/markets
- POST /api/perps/order
- POST /api/perps/close
- GET /api/perps/orders?address=
- POST /api/perps/cancel
- POST /api/perps/solana/deposit
- POST /api/perps/solana/withdraw
- POST /api/perps/solana/prepare-open
- POST /api/perps/solana/prepare-close
- POST /api/perps/solana/prepare-deposit
- POST /api/perps/solana/prepare-withdraw
- GET /api/perps/positions?address=
- GET /api/perps/history?address=
- GET /api/perps/alerts?address=

## WebSocket
- ws://<host>/ws/perps
- Subscribe payload: {"type":"subscribe","market":"btcusdt"}

## TP/SL
Provide `tpPrice` and `slPrice` in the order payload to set take profit and stop loss on the opened position.

## Reduce-only & Partial Close
- Set `reduceOnly=true` to ensure orders only decrease existing positions.
- Use `POST /api/perps/close` with `size` to partially close an open position.

## Environment
Set DATABASE_URL and optional PERPS_PORT, PERPS_MARKETS, PERPS_MARKET_WS.
Set PERPS_EVM_RPC, PERPS_SOLANA_RPC, PERPS_EVM_CONTRACT, PERPS_SOLANA_PROGRAM for settlement adapters.
Set PERPS_SOLANA_FEE_PAYER_SECRET (JSON array), PERPS_SOLANA_COLLATERAL_MINT, PERPS_SOLANA_VAULT to enable Solana settlement.

## Order Payload
```json
{
	"walletAddress": "0x...",
	"market": "btcusdt",
	"side": "long",
	"orderType": "market",
	"price": 98000,
	"amount": 100,
	"leverage": 10,
	"executionModel": "hybrid",
	"tpPrice": 102000,
	"slPrice": 96000
}
```
