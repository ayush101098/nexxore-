# Nexxore Payment System

## Architecture

```
User pays ETH → Your Wallet
       ↓
Alchemy Webhook detects transaction
       ↓
Payment Server validates amount
       ↓
Supabase stores subscription
       ↓
Email sent to user
       ↓
Frontend checks subscription status
```

## Setup Guide

### 1. Supabase Database

Create a free account at [supabase.com](https://supabase.com) and run this SQL:

```sql
-- Subscriptions table
CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) UNIQUE NOT NULL,
  tx_hash VARCHAR(66),
  amount_eth DECIMAL(18, 8),
  amount_usd DECIMAL(10, 2),
  tier VARCHAR(50) DEFAULT 'agent_pro',
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment logs for audit
CREATE TABLE payment_logs (
  id SERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) UNIQUE,
  from_address VARCHAR(42),
  to_address VARCHAR(42),
  value_wei VARCHAR(78),
  value_eth DECIMAL(18, 8),
  block_number INTEGER,
  status VARCHAR(20),
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Waitlist with wallet mapping
CREATE TABLE waitlist (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  wallet_address VARCHAR(42),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_subscriptions_wallet ON subscriptions(wallet_address);
CREATE INDEX idx_subscriptions_expires ON subscriptions(expires_at);
CREATE INDEX idx_payment_logs_from ON payment_logs(from_address);
```

### 2. Alchemy Webhook

1. Go to [Alchemy Dashboard](https://dashboard.alchemy.com/)
2. Create new webhook → **Address Activity**
3. Network: **Ethereum Mainnet**
4. Address: `0x905aCd442c7B3EF9BfEB0A3189f3686c1Cd0c697`
5. Webhook URL: `https://your-domain.com/webhook/payment`
6. Copy the **Signing Key** to your `.env`

### 3. Email (Gmail App Password)

1. Enable 2FA on your Google account
2. Go to: https://myaccount.google.com/apppasswords
3. Create new app password for "Mail"
4. Use this password in `.env` as `SMTP_PASS`

### 4. Deploy

**Option A: Railway**
```bash
cd backend/payment-webhook
railway init
railway up
```

**Option B: Render**
- Connect GitHub repo
- Set root directory: `backend/payment-webhook`
- Add environment variables

**Option C: Vercel (Serverless)**
- Convert to API routes in `/api/webhook/payment.js`

### 5. Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbG...
ALCHEMY_SIGNING_KEY=xxx
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
ADMIN_KEY=your-secret-key
```

## API Endpoints

### Webhook (Alchemy calls this)
```
POST /webhook/payment
```

### Check Subscription (Frontend uses this)
```
GET /api/subscription/:walletAddress
```

Response:
```json
{
  "active": true,
  "tier": "agent_pro",
  "expiresAt": "2026-02-27T00:00:00Z"
}
```

### Manual Verification (Admin only)
```
POST /admin/verify-payment
{
  "adminKey": "your-secret",
  "walletAddress": "0x...",
  "txHash": "0x..."
}
```

## Frontend Integration

Frontend integration is already implemented in `agents.html`. The page automatically:
- Checks subscription status when wallet is connected
- Updates the "Agent Pro" button to show "✓ Access Granted" for active subscribers
- Shows pricing modal for non-subscribers

Update the API URL in `agents.html` to match your deployed backend URL:
```javascript
const res = await fetch(`https://your-backend.vercel.app/api/subscription/${walletAddress}`);
```

## Testing

1. Send a small amount of ETH (testnet first!) to the payment address
2. Check Alchemy dashboard for webhook delivery
3. Check Supabase for new subscription record
4. Verify email was sent

## Costs

- **Supabase**: Free tier (500MB, 2GB bandwidth)
- **Alchemy**: Free tier (300M compute units)
- **Railway/Render**: Free tier available
- **Email**: Free with Gmail

Total: **$0/month** for MVP
