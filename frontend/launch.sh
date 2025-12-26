#!/bin/bash

# Nexxore Vault Launch Script

echo "🚀 Starting Nexxore Vault..."
echo ""

# Check if Hardhat node is running
if lsof -ti:8545 > /dev/null 2>&1; then
    echo "✅ Hardhat node is running on port 8545"
else
    echo "❌ Hardhat node is NOT running!"
    echo "Starting Hardhat node..."
    cd ../contracts/evm
    npx hardhat node > /dev/null 2>&1 &
    sleep 3
    echo "✅ Hardhat node started"
    cd ../../frontend
fi

# Check if HTTP server is running
if lsof -ti:8000 > /dev/null 2>&1; then
    echo "✅ HTTP server is already running on port 8000"
else
    echo "Starting HTTP server on port 8000..."
    python3 -m http.server 8000 > /dev/null 2>&1 &
    sleep 1
    echo "✅ HTTP server started"
fi

echo ""
echo "📊 System Status:"
echo "   Hardhat Node: http://127.0.0.1:8545"
echo "   Frontend: http://localhost:8000"
echo "   Vault Address: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
echo ""
echo "🌐 Opening start page..."
open http://localhost:8000/start.html

echo ""
echo "✅ All systems ready!"
echo ""
echo "Quick Links:"
echo "   Home: http://localhost:8000/index.html"
echo "   Deposit: http://localhost:8000/deposit-new.html"
echo "   Vault: http://localhost:8000/vault-new.html"
echo "   Test: http://localhost:8000/test-metamask.html"
echo ""
echo "Press Ctrl+C to stop"
