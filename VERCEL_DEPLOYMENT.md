# Vercel Deployment Guide

## Quick Fix for FUNCTION_INVOCATION_FAILED

The serverless functions are now **self-contained** and don't require any external dependencies or environment variables to work. They will function immediately upon deployment.

## Optional Environment Variables

For enhanced functionality, you can add these in Vercel Project Settings:

```bash
NEWS_API_KEY=your_newsapi_key  # For real news (falls back to mock data)
```

**Note:** The functions work WITHOUT these - they use fallback data and public APIs.

## Deploy to Vercel

1. **Connect GitHub repository** to Vercel
2. **Import project** from GitHub
3. **Deploy** - No configuration needed!
4. *Optional*: Add NEWS_API_KEY in Project Settings → Environment Variables

## API Endpoints (Serverless Functions)

All endpoints work immediately at your Vercel domain:

- `GET /api/health` - Health check (always works)
- `GET /api/news` - Crypto news (mock data or NewsAPI if key provided)
- `GET /api/trending` - Trending tokens from CoinGecko (public API)
- `GET /api/research/insights?protocols=aave,curve` - Protocol TVL analysis from DeFi Llama
- `POST /api/chat` - Simple keyword-based chat (no OpenAI needed)

## What Changed to Fix the Error

**Before:** Functions tried to `require()` agent classes from `/agents` directory
**After:** Each function is completely self-contained with inline code

This works in Vercel's isolated serverless environment.

## Frontend Pages

- `/` or `/index.html` - Landing page
- `/research.html` - Research intelligence dashboard
- `/deposit-new.html` - Deposit interface
- `/vault-new.html` - Vault management

## Local Development

For local development, use the standalone server:

```bash
cd agents
node server.js
```

This runs on `http://localhost:3000` with the same API endpoints.

## Architecture

- **Frontend**: Static HTML/CSS/JS served from `/frontend`
- **API**: Serverless functions in `/api` directory
- **Agents**: Intelligence agents in `/agents` (shared code)

The frontend automatically detects the environment:
- Production: Uses `/api` (relative path)
- Development: Uses `http://localhost:3000/api`

## Troubleshooting

If you see "FUNCTION_INVOCATION_FAILED":
1. Check environment variables are set in Vercel
2. Check build logs for dependency errors
3. Verify Node.js version is >= 18.0.0
4. Check function timeout limits (default 10s, max 60s on Pro)
