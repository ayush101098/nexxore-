# Vercel Deployment Guide

## ✅ Fixed: 404 NOT_FOUND Error

**Solution:** All frontend files are now in the **root directory** where Vercel expects them.

## Deployment Status

Your site structure on Vercel:
- `https://your-domain.vercel.app/` → index.html (landing page)
- `https://your-domain.vercel.app/research.html` → Research intelligence dashboard
- `https://your-domain.vercel.app/deposit-new.html` → Deposit interface
- `https://your-domain.vercel.app/vault-new.html` → Vault management
- `https://your-domain.vercel.app/api/health` → API health check
- `https://your-domain.vercel.app/api/research/insights` → Protocol analysis

## How It Works

1. **Static Files (HTML, CSS, JS)**: Served directly from root directory
2. **API Endpoints**: Serverless functions in `/api` directory
3. **Auto-deployment**: Every push to `main` branch triggers Vercel build

## Verify Deployment

After Vercel redeploys (automatic from GitHub), test:

```bash
# Homepage
curl https://your-domain.vercel.app/

# Research page
curl https://your-domain.vercel.app/research.html

# API health
curl https://your-domain.vercel.app/api/health

# Protocol insights
curl https://your-domain.vercel.app/api/research/insights?protocols=aave
```

## Project Structure

```
/
├── index.html              ← Landing page
├── research.html           ← Research dashboard  
├── deposit-new.html        ← Deposit interface
├── vault-new.html          ← Vault page
├── css/                    ← Stylesheets
├── js/                     ← JavaScript
├── assets/                 ← Icons, images
└── api/                    ← Serverless functions
    ├── health.js
    ├── news.js
    ├── trending.js
    ├── chat.js
    └── research/
        └── insights.js
```

## Quick Fix Summary

**Before:** Files in `/frontend` folder → Vercel couldn't find them → 404
**After:** Files in root `/` → Vercel serves them directly → Works! ✅

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
