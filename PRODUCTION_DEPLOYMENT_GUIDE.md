# 🚀 Nexxore Perps - Production Deployment Guide

## Table of Contents
- [Prerequisites](#prerequisites)
- [Quick Start (Docker)](#quick-start-docker)
- [Manual Deployment](#manual-deployment)
- [Database Setup](#database-setup)
- [Environment Configuration](#environment-configuration)
- [Security Hardening](#security-hardening)
- [Monitoring & Maintenance](#monitoring--maintenance)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software
- ✅ **Node.js** v18+ ([Download](https://nodejs.org/))
- ✅ **PostgreSQL** v14+ ([Download](https://www.postgresql.org/download/))
- ✅ **Redis** v7+ (optional, for caching)
- ✅ **Docker & Docker Compose** (for containerized deployment)

### System Requirements
- **RAM**: 2GB minimum, 4GB recommended
- **CPU**: 2 cores minimum
- **Disk**: 10GB available space
- **Network**: Stable internet connection for HyperLiquid API

---

## Quick Start (Docker)

### Option 1: Docker Compose (Recommended)

```bash
# 1. Clone repository
cd /Users/ayushmishra/nexxore-

# 2. Create environment file
cp backend/services/perps/.env.production .env
# Edit .env with your configuration

# 3. Set secrets
export DB_PASSWORD="your-secure-db-password"
export REDIS_PASSWORD="your-secure-redis-password"
export JWT_SECRET="your-jwt-secret-key"

# 4. Start all services
docker-compose -f docker-compose.perps.yml up -d

# 5. Check health
curl http://localhost:3010/api/perps/health

# 6. View logs
docker-compose -f docker-compose.perps.yml logs -f perps

# 7. Access trading interface
open http://localhost/perps.html
```

### Stopping Services
```bash
docker-compose -f docker-compose.perps.yml down
```

### Restart Services
```bash
docker-compose -f docker-compose.perps.yml restart perps
```

---

## Manual Deployment

### Step 1: Database Setup

```bash
# Create database
createdb nexxore_prod

# Apply schema
cd /Users/ayushmishra/nexxore-
psql nexxore_prod < database/schema.sql
psql nexxore_prod < backend/services/perps/schema.sql

# Verify tables
psql nexxore_prod -c "\dt"
```

Expected tables:
- `perps_trades`
- `perps_user_trades`
- `perps_positions`
- `perps_orders`
- `perps_alerts`
- `perps_liquidations`

### Step 2: Install Dependencies

```bash
cd backend
npm install --production
```

### Step 3: Configure Environment

```bash
cd services/perps
cp .env.production .env

# Edit .env file
nano .env
```

**Critical Variables:**
```env
DATABASE_URL=postgresql://localhost/nexxore_prod
PERPS_PORT=3010
USE_HYPERLIQUID=true
NODE_ENV=production
```

### Step 4: Deploy Service

```bash
# Run deployment script
chmod +x deploy-production.sh
./deploy-production.sh
```

Or manually:
```bash
# Start service
node index.js

# Or with PM2 (recommended for production)
npm install -g pm2
pm2 start index.js --name nexxore-perps
pm2 save
pm2 startup
```

### Step 5: Verify Deployment

```bash
# Check health
curl http://localhost:3010/api/perps/health

# Check markets
curl http://localhost:3010/api/perps/markets

# Test WebSocket (requires wscat: npm install -g wscat)
wscat -c ws://localhost:3010/ws/perps
```

---

## Environment Configuration

### Production Environment Variables

#### Database
```env
DATABASE_URL=postgresql://user:pass@host:5432/nexxore_prod?sslmode=require
```

#### HyperLiquid Integration
```env
USE_HYPERLIQUID=true
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz
PERPS_MARKETS=BTC,ETH,SOL,HYPE,ARB,OP,AVAX,MATIC,DOGE,LINK,UNI,ATOM,LTC,BCH,ETC,FIL,APT,STX,INJ,TIA
```

#### Security
```env
JWT_SECRET=<generate-with-openssl-rand-hex-32>
CORS_ORIGINS=https://nexxore.xyz,https://www.nexxore.xyz
RATE_LIMIT_MAX_REQUESTS=100
```

#### Risk Parameters
```env
PERPS_MAX_LEVERAGE=50
PERPS_MAINT_MARGIN=0.005
PERPS_MAKER_FEE=0.0002
PERPS_TAKER_FEE=0.0006
```

---

## Security Hardening

### 1. Database Security

```sql
-- Create dedicated user
CREATE USER perps_service WITH PASSWORD 'strong-password';
GRANT CONNECT ON DATABASE nexxore_prod TO perps_service;
GRANT USAGE ON SCHEMA public TO perps_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO perps_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO perps_service;
```

### 2. Firewall Rules

```bash
# Allow only necessary ports
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# Block direct access to backend (use nginx proxy)
sudo ufw deny 3010/tcp
sudo ufw deny 3011/tcp
```

### 3. SSL/TLS Setup

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d nexxore.xyz -d www.nexxore.xyz

# Auto-renewal
sudo certbot renew --dry-run
```

### 4. Rate Limiting

Already configured in nginx.conf:
- API: 100 requests/second
- WebSocket: 10 connections/second

### 5. Environment Secrets

```bash
# Never commit .env files
echo ".env" >> .gitignore
echo ".env.*" >> .gitignore

# Use environment variables or secrets management
export DATABASE_URL="postgresql://..."
export JWT_SECRET="..."
```

---

## Monitoring & Maintenance

### Health Monitoring

```bash
# Check service health
curl http://localhost:3010/api/perps/health

# Expected response
{
  "status": "ok",
  "wsConnected": true,
  "time": "2026-02-04T12:00:00.000Z"
}
```

### Log Monitoring

```bash
# Real-time logs (Docker)
docker-compose -f docker-compose.perps.yml logs -f perps

# Real-time logs (PM2)
pm2 logs nexxore-perps

# Check error logs
tail -f backend/services/perps/logs/perps.log
```

### Database Maintenance

```sql
-- Check database size
SELECT pg_size_pretty(pg_database_size('nexxore_prod'));

-- Vacuum and analyze
VACUUM ANALYZE perps_positions;
VACUUM ANALYZE perps_orders;
VACUUM ANALYZE perps_trades;

-- Check active connections
SELECT count(*) FROM pg_stat_activity;

-- Index usage
SELECT schemaname, tablename, indexname, idx_scan 
FROM pg_stat_user_indexes 
WHERE schemaname = 'public';
```

### Performance Monitoring

```bash
# CPU and Memory usage
docker stats nexxore-perps

# PM2 monitoring
pm2 monit

# Database performance
psql nexxore_prod -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"
```

### Backup Strategy

```bash
# Database backup
pg_dump nexxore_prod > backup_$(date +%Y%m%d).sql

# Automated daily backups
cat > /etc/cron.daily/nexxore-backup << 'EOF'
#!/bin/bash
pg_dump nexxore_prod | gzip > /backups/nexxore_$(date +%Y%m%d).sql.gz
find /backups -name "nexxore_*.sql.gz" -mtime +30 -delete
EOF
chmod +x /etc/cron.daily/nexxore-backup
```

---

## Troubleshooting

### Service Won't Start

**Check logs:**
```bash
docker-compose -f docker-compose.perps.yml logs perps
# or
tail -f backend/services/perps/logs/perps.log
```

**Common issues:**
1. **Database connection error**
   - Verify DATABASE_URL is correct
   - Check PostgreSQL is running: `pg_isready`
   - Test connection: `psql $DATABASE_URL -c "SELECT 1"`

2. **Port already in use**
   - Check what's using port: `lsof -i :3010`
   - Kill process or change PERPS_PORT

3. **Missing dependencies**
   - Reinstall: `npm install --production`

### WebSocket Not Connecting

**Frontend shows 404 for /ws/perps:**
1. Verify service is running: `curl http://localhost:3010/api/perps/health`
2. Check WS server started: `grep "WebSocket server" logs/perps.log`
3. Test WebSocket: `wscat -c ws://localhost:3010/ws/perps`

**If using nginx:**
- Verify proxy configuration in nginx.conf
- Test direct connection: `wscat -c ws://localhost:3011`

### Prices Not Updating

**Check HyperLiquid connection:**
```bash
curl http://localhost:3010/api/perps/markets | jq
```

**Check WebSocket status in logs:**
```bash
grep -i "hyperliquid\|websocket" logs/perps.log
```

**Fallback to Binance:**
- If HyperLiquid fails, service falls back to Binance
- Check PERPS_MARKET_WS in .env

### Database Issues

**Too many connections:**
```sql
-- Check connection limit
SHOW max_connections;

-- View active connections
SELECT count(*) FROM pg_stat_activity;

-- Increase connection limit (requires restart)
ALTER SYSTEM SET max_connections = 100;
```

**Slow queries:**
```sql
-- Enable query logging
ALTER SYSTEM SET log_min_duration_statement = 1000; -- Log queries > 1s

-- Create indexes for performance
CREATE INDEX idx_positions_wallet ON perps_positions(wallet_address);
CREATE INDEX idx_orders_wallet ON perps_orders(wallet_address);
CREATE INDEX idx_trades_wallet ON perps_trades(wallet_address);
```

### Memory Issues

**Container OOM (Out of Memory):**
```yaml
# In docker-compose.perps.yml, add memory limits
services:
  perps:
    mem_limit: 2g
    memswap_limit: 2g
```

**Node.js heap:**
```bash
# Increase heap size
NODE_OPTIONS="--max-old-space-size=4096" node index.js
```

---

## Production Checklist

Before going live:

- [ ] ✅ Database backups configured
- [ ] ✅ SSL/TLS certificates installed
- [ ] ✅ Environment variables secured
- [ ] ✅ Firewall rules configured
- [ ] ✅ Rate limiting enabled
- [ ] ✅ Health monitoring setup
- [ ] ✅ Log rotation configured
- [ ] ✅ Error tracking (Sentry) setup
- [ ] ✅ Load testing completed
- [ ] ✅ Disaster recovery plan documented
- [ ] ✅ Team access credentials distributed
- [ ] ✅ Monitoring alerts configured

---

## Support

- **Documentation**: [PERPS_FULLY_WORKABLE.md](backend/services/perps/PERPS_FULLY_WORKABLE.md)
- **HyperLiquid Integration**: [HYPERLIQUID_README.md](backend/services/perps/HYPERLIQUID_README.md)
- **Test Reports**: [PERPS_TEST_REPORT.md](PERPS_TEST_REPORT.md)

---

## License

MIT License - See LICENSE file for details
