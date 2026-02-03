#!/bin/bash

echo "════════════════════════════════════════════════════════"
echo "  🚀 NEXXORE PERPS - QUICK START GUIDE"
echo "════════════════════════════════════════════════════════"
echo ""
echo "✅ PERPS IS NOW FULLY WORKABLE WITH HYPERLIQUID!"
echo ""
echo "📊 Top 20 Markets Ready:"
echo "   BTC, ETH, SOL, HYPE, ARB, OP, AVAX, MATIC,"
echo "   DOGE, LINK, UNI, ATOM, LTC, BCH, ETC, FIL,"
echo "   APT, STX, INJ, TIA"
echo ""
echo "════════════════════════════════════════════════════════"
echo ""
echo "🔧 SETUP STEPS:"
echo ""
echo "1️⃣  Ensure PostgreSQL is running"
echo "   → Check: psql -c 'SELECT 1'"
echo ""
echo "2️⃣  Create database (if not exists)"
echo "   → Run: psql -c 'CREATE DATABASE nexxore'"
echo ""
echo "3️⃣  Apply schema"
echo "   → cd /Users/ayushmishra/nexxore-/backend/services/perps"
echo "   → psql -d nexxore -f schema.sql"
echo ""
echo "4️⃣  Set environment variables"
echo "   → Create .env file:"
echo "     DATABASE_URL=postgresql://localhost/nexxore"
echo "     USE_HYPERLIQUID=true"
echo ""
echo "5️⃣  Start the perps service"
echo "   → ./start-perps.sh"
echo ""
echo "6️⃣  Open trading interface"
echo "   → open /Users/ayushmishra/nexxore-/perps.html"
echo "   → Or: npx http-server -p 8080"
echo ""
echo "════════════════════════════════════════════════════════"
echo ""
echo "📚 DOCUMENTATION:"
echo "   → PERPS_FULLY_WORKABLE.md - Complete overview"
echo "   → HYPERLIQUID_README.md - Technical details"
echo ""
echo "🎯 WHY HYPERLIQUID?"
echo "   ✅ No smart contract deployment"
echo "   ✅ Deep liquidity already exists"
echo "   ✅ 20 markets ready instantly"
echo "   ✅ Zero gas fees"
echo "   ✅ Production-ready infrastructure"
echo ""
echo "🚀 READY TO START?"
echo ""
read -p "Press ENTER to check PostgreSQL status..."

if command -v psql &> /dev/null; then
    echo ""
    echo "✅ PostgreSQL CLI found"
    
    if psql -c "SELECT 1" &> /dev/null; then
        echo "✅ PostgreSQL is running"
        
        if psql -lqt | cut -d \| -f 1 | grep -qw nexxore; then
            echo "✅ Database 'nexxore' exists"
            echo ""
            echo "🎉 All prerequisites met!"
            echo ""
            read -p "Start perps service now? (y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                cd /Users/ayushmishra/nexxore-/backend/services/perps
                ./start-perps.sh
            fi
        else
            echo "⚠️  Database 'nexxore' not found"
            echo ""
            read -p "Create database now? (y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                psql -c "CREATE DATABASE nexxore"
                echo "✅ Database created"
                echo "📝 Now apply schema: psql -d nexxore -f schema.sql"
            fi
        fi
    else
        echo "❌ PostgreSQL is not running"
        echo "   Start it with: brew services start postgresql"
    fi
else
    echo "❌ PostgreSQL not found"
    echo "   Install with: brew install postgresql"
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "For detailed help, read: PERPS_FULLY_WORKABLE.md"
echo "════════════════════════════════════════════════════════"
