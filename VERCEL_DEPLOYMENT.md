# Vercel Deployment Guide

## Environment Variables

Set these in your Vercel project settings:

```bash
NEWS_API_KEY=your_newsapi_key
OPENAI_API_KEY=your_openai_key
COINGECKO_API_KEY=your_coingecko_key  # Optional
TELEGRAM_BOT_TOKEN=your_telegram_token  # Optional
X_API_KEY=your_x_api_key  # Optional
```

## Deploy to Vercel

1. **Connect your GitHub repository** to Vercel
2. **Import the project** from GitHub
3. **Add environment variables** in Project Settings → Environment Variables
4. **Deploy** - Vercel will automatically build and deploy

## API Endpoints (Serverless Functions)

All endpoints are automatically available at your Vercel domain:

- `GET /api/health` - Health check and agent status
- `GET /api/news` - Latest crypto news
- `GET /api/trending` - Trending tokens from CoinGecko
- `GET /api/research/insights?protocols=aave,curve` - Protocol analysis
- `POST /api/chat` - AI chat assistant

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
