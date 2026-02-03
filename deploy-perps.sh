#!/bin/bash

# ═══════════════════════════════════════════════════════════
# 🚀 NEXXORE PERPS - ONE-CLICK PRODUCTION DEPLOY
# ═══════════════════════════════════════════════════════════

set -e

echo "════════════════════════════════════════════════════════"
echo "  🚀 NEXXORE PERPS - PRODUCTION DEPLOYMENT"
echo "════════════════════════════════════════════════════════"
echo ""
echo "Choose deployment method:"
echo ""
echo "1) Docker Compose (Recommended - All-in-one)"
echo "2) Manual Deployment (Custom setup)"
echo "3) Development Mode (Testing)"
echo ""
read -p "Enter choice [1-3]: " choice

case $choice in
  1)
    echo ""
    echo "🐳 Docker Compose Deployment Selected"
    echo "════════════════════════════════════════════════════════"
    echo ""
    
    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        echo "❌ Docker is not installed"
        echo "Install from: https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        echo "❌ Docker Compose is not installed"
        echo "Install from: https://docs.docker.com/compose/install/"
        exit 1
    fi
    
    echo "✅ Docker and Docker Compose found"
    echo ""
    
    # Create .env if not exists
    if [ ! -f .env ]; then
        echo "📝 Creating .env file..."
        cat > .env << EOF
# Generated $(date)
DB_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
CORS_ORIGINS=http://localhost,http://localhost:8080
EOF
        echo "✅ .env file created with random secrets"
        echo ""
    fi
    
    # Pull images
    echo "📥 Pulling Docker images..."
    docker-compose -f docker-compose.perps.yml pull
    
    # Build custom images
    echo "🏗️  Building custom images..."
    docker-compose -f docker-compose.perps.yml build
    
    # Start services
    echo "🚀 Starting services..."
    docker-compose -f docker-compose.perps.yml up -d
    
    # Wait for services to be healthy
    echo "⏳ Waiting for services to be ready..."
    sleep 10
    
    # Check health
    if curl -f -s http://localhost:3010/api/perps/health > /dev/null; then
        echo ""
        echo "════════════════════════════════════════════════════════"
        echo "  ✅ DEPLOYMENT SUCCESSFUL!"
        echo "════════════════════════════════════════════════════════"
        echo ""
        echo "📊 Service URLs:"
        echo "  → Trading UI:  http://localhost/perps.html"
        echo "  → API:         http://localhost:3010/api/perps/health"
        echo "  → WebSocket:   ws://localhost:3011/ws/perps"
        echo ""
        echo "🔧 Management:"
        echo "  → View logs:   docker-compose -f docker-compose.perps.yml logs -f"
        echo "  → Stop:        docker-compose -f docker-compose.perps.yml down"
        echo "  → Restart:     docker-compose -f docker-compose.perps.yml restart"
        echo ""
    else
        echo "❌ Health check failed"
        echo "Check logs: docker-compose -f docker-compose.perps.yml logs perps"
        exit 1
    fi
    ;;
    
  2)
    echo ""
    echo "⚙️  Manual Deployment Selected"
    echo "════════════════════════════════════════════════════════"
    echo ""
    cd backend/services/perps
    ./deploy-production.sh
    ;;
    
  3)
    echo ""
    echo "🧪 Development Mode Selected"
    echo "════════════════════════════════════════════════════════"
    echo ""
    
    # Check if PostgreSQL is running
    if ! psql -c "SELECT 1" &> /dev/null; then
        echo "❌ PostgreSQL is not running"
        echo "Start PostgreSQL and try again"
        exit 1
    fi
    
    # Create dev database
    createdb nexxore_dev 2>/dev/null || echo "Database already exists"
    
    # Apply schema
    psql nexxore_dev < database/schema.sql
    psql nexxore_dev < backend/services/perps/schema.sql
    
    # Create dev .env
    cat > backend/services/perps/.env << EOF
DATABASE_URL=postgresql://localhost/nexxore_dev
PERPS_PORT=3010
USE_HYPERLIQUID=true
NODE_ENV=development
ENABLE_DEBUG_ENDPOINTS=true
EOF
    
    # Install dependencies
    cd backend
    npm install
    
    # Start service in dev mode
    echo "🚀 Starting development server..."
    npm run perps:dev
    ;;
    
  *)
    echo "Invalid choice"
    exit 1
    ;;
esac
