#!/bin/bash

# ═══════════════════════════════════════════════════════════
# 🚀 NEXXORE PERPS - PRODUCTION DEPLOYMENT SCRIPT
# ═══════════════════════════════════════════════════════════

set -e  # Exit on any error

echo "════════════════════════════════════════════════════════"
echo "  🚀 NEXXORE PERPS - PRODUCTION DEPLOYMENT"
echo "════════════════════════════════════════════════════════"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="/Users/ayushmishra/nexxore-"
PERPS_DIR="$PROJECT_DIR/backend/services/perps"
LOG_DIR="$PERPS_DIR/logs"
PID_FILE="$PERPS_DIR/perps.pid"

# Create log directory
mkdir -p "$LOG_DIR"

# ═══════════════════════════════════════════════════════════
# STEP 1: Pre-flight Checks
# ═══════════════════════════════════════════════════════════
echo -e "${BLUE}[1/8]${NC} Running pre-flight checks..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js version:${NC} $(node --version)"

# Check PostgreSQL
if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}⚠ PostgreSQL client not found${NC}"
else
    echo -e "${GREEN}✓ PostgreSQL client found${NC}"
fi

# Check if .env exists
if [ ! -f "$PERPS_DIR/.env" ]; then
    echo -e "${YELLOW}⚠ .env file not found. Copying from .env.production${NC}"
    cp "$PERPS_DIR/.env.production" "$PERPS_DIR/.env"
    echo -e "${YELLOW}⚠ Please edit .env file with your configuration${NC}"
    echo -e "${YELLOW}  Then run this script again${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Environment configuration found${NC}"

cd "$PERPS_DIR"

# ═══════════════════════════════════════════════════════════
# STEP 2: Install Dependencies
# ═══════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}[2/8]${NC} Installing dependencies..."

cd "$PROJECT_DIR/backend"
if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install --production
else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi

# ═══════════════════════════════════════════════════════════
# STEP 3: Database Setup
# ═══════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}[3/8]${NC} Setting up database..."

# Load DATABASE_URL from .env
export $(grep -v '^#' "$PERPS_DIR/.env" | xargs)

if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}✗ DATABASE_URL not set in .env${NC}"
    exit 1
fi

# Test database connection
if psql "$DATABASE_URL" -c "SELECT 1" &> /dev/null; then
    echo -e "${GREEN}✓ Database connection successful${NC}"
else
    echo -e "${RED}✗ Cannot connect to database${NC}"
    echo "Please check your DATABASE_URL in .env"
    exit 1
fi

# Run migrations
echo "Running database migrations..."
cd "$PERPS_DIR"
psql "$DATABASE_URL" -f schema.sql
echo -e "${GREEN}✓ Database schema up to date${NC}"

# ═══════════════════════════════════════════════════════════
# STEP 4: Build Assets (if needed)
# ═══════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}[4/8]${NC} Checking frontend assets..."

if [ -f "$PROJECT_DIR/perps.html" ]; then
    echo -e "${GREEN}✓ Frontend assets found${NC}"
else
    echo -e "${YELLOW}⚠ Frontend files not found${NC}"
fi

# ═══════════════════════════════════════════════════════════
# STEP 5: Stop Existing Service
# ═══════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}[5/8]${NC} Stopping existing service..."

if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p $OLD_PID > /dev/null 2>&1; then
        echo "Stopping process $OLD_PID..."
        kill $OLD_PID
        sleep 2
        if ps -p $OLD_PID > /dev/null 2>&1; then
            echo "Force killing process $OLD_PID..."
            kill -9 $OLD_PID
        fi
        echo -e "${GREEN}✓ Old service stopped${NC}"
    else
        echo -e "${YELLOW}⚠ PID file exists but process not running${NC}"
    fi
    rm "$PID_FILE"
else
    echo -e "${GREEN}✓ No existing service running${NC}"
fi

# ═══════════════════════════════════════════════════════════
# STEP 6: Start Service
# ═══════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}[6/8]${NC} Starting perps service..."

cd "$PERPS_DIR"

# Start service in background
nohup node index.js > "$LOG_DIR/perps.log" 2>&1 &
SERVICE_PID=$!
echo $SERVICE_PID > "$PID_FILE"

echo "Service started with PID: $SERVICE_PID"
echo "Waiting for service to initialize..."
sleep 3

# Check if process is still running
if ps -p $SERVICE_PID > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Service is running${NC}"
else
    echo -e "${RED}✗ Service failed to start${NC}"
    echo "Check logs: tail -f $LOG_DIR/perps.log"
    exit 1
fi

# ═══════════════════════════════════════════════════════════
# STEP 7: Health Check
# ═══════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}[7/8]${NC} Running health check..."

PERPS_PORT=${PERPS_PORT:-3010}
MAX_ATTEMPTS=10
ATTEMPT=1

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    echo "Attempt $ATTEMPT/$MAX_ATTEMPTS..."
    
    if curl -f -s "http://localhost:$PERPS_PORT/api/perps/health" > /dev/null; then
        HEALTH=$(curl -s "http://localhost:$PERPS_PORT/api/perps/health")
        echo -e "${GREEN}✓ Health check passed${NC}"
        echo "Response: $HEALTH"
        break
    else
        if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
            echo -e "${RED}✗ Health check failed after $MAX_ATTEMPTS attempts${NC}"
            echo "Check logs: tail -f $LOG_DIR/perps.log"
            exit 1
        fi
        sleep 2
        ATTEMPT=$((ATTEMPT + 1))
    fi
done

# ═══════════════════════════════════════════════════════════
# STEP 8: Summary
# ═══════════════════════════════════════════════════════════
echo ""
echo "════════════════════════════════════════════════════════"
echo -e "  ${GREEN}✓ DEPLOYMENT SUCCESSFUL${NC}"
echo "════════════════════════════════════════════════════════"
echo ""
echo "📊 Service Information:"
echo "  → PID: $SERVICE_PID"
echo "  → Port: $PERPS_PORT"
echo "  → Logs: $LOG_DIR/perps.log"
echo ""
echo "🔗 API Endpoints:"
echo "  → Health: http://localhost:$PERPS_PORT/api/perps/health"
echo "  → Markets: http://localhost:$PERPS_PORT/api/perps/markets"
echo "  → WebSocket: ws://localhost:$PERPS_PORT/ws/perps"
echo ""
echo "📝 Management Commands:"
echo "  → View logs:    tail -f $LOG_DIR/perps.log"
echo "  → Stop service: kill $SERVICE_PID"
echo "  → Restart:      $0"
echo ""
echo "🎯 Next Steps:"
echo "  1. Open perps interface: http://localhost:8080/perps.html"
echo "  2. Monitor logs for any errors"
echo "  3. Test trading functionality"
echo "  4. Set up reverse proxy (nginx) for production"
echo ""
echo "════════════════════════════════════════════════════════"
