#!/bin/bash

# Start Nexxore Perps Service with HyperLiquid Integration

echo "🚀 Starting Nexxore Perps Service..."
echo "📊 Mode: HyperLiquid Top 20 Markets"
echo ""

# Set environment
export USE_HYPERLIQUID=true
export PERPS_PORT=3010
export HYPERLIQUID_API_URL=https://api.hyperliquid.xyz

# Default markets if not set
if [ -z "$PERPS_MARKETS" ]; then
  export PERPS_MARKETS="BTC,ETH,SOL,HYPE,ARB,OP,AVAX,MATIC,DOGE,LINK,UNI,ATOM,LTC,BCH,ETC,FIL,APT,STX,INJ,TIA"
fi

echo "Markets: $PERPS_MARKETS"
echo ""

# Start service
node index.js
