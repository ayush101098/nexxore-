#!/bin/bash

echo "🎯 Nexxore - System Status Check"
echo "=================================="
echo ""

# Check Hardhat Node
if lsof -ti:8545 > /dev/null 2>&1; then
    echo "✅ Hardhat Node (Port 8545): RUNNING"
else
    echo "❌ Hardhat Node (Port 8545): NOT RUNNING"
fi

# Check Agent Server
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "✅ Agent Server (Port 3000): RUNNING"
else
    echo "❌ Agent Server (Port 3000): NOT RUNNING"
fi

# Check HTTP Server  
if lsof -ti:8000 > /dev/null 2>&1; then
    echo "✅ HTTP Server (Port 8000): RUNNING"
else
    echo "❌ HTTP Server (Port 8000): NOT RUNNING"
fi

echo ""
echo "📍 Quick Access URLs:"
echo "   Dashboard: http://localhost:8000/dashboard.html"
echo "   Research (Info Edge): http://localhost:8000/research.html"
echo "   Deposit: http://localhost:8000/deposit-new.html"
echo "   Vault: http://localhost:8000/vault-new.html"
echo ""
echo "📊 System Info:"
echo "   Vault Address: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
echo "   Network: Localhost 8545 (Chain ID: 31337)"
echo "   Agent API: http://localhost:3000/api"
echo ""
