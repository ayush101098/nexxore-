# Nexxore - Autonomous Capital Orchestration

Multi-chain DeFi vault with AI-powered intelligence agents for automated yield optimization.

## 🚀 Live Demo

- **Production**: [https://your-domain.vercel.app](https://your-domain.vercel.app)
- **Research Dashboard**: [https://your-domain.vercel.app/research.html](https://your-domain.vercel.app/research.html)

## 📁 Project Structure

```
nexxore/
├── index.html              # Landing page
├── research.html           # AI Research Intelligence Dashboard
├── deposit-new.html        # Multi-chain deposit interface
├── vault-new.html          # Vault management UI
├── css/                    # Stylesheets
├── js/                     # Frontend JavaScript
│   ├── wallet/            # Wallet integrations (EVM, Solana, Bitcoin)
│   └── components/        # UI components
├── api/                    # Vercel Serverless Functions
│   ├── health.js          # Health check
│   ├── news.js            # Crypto news aggregation
│   ├── trending.js        # Trending tokens
│   ├── chat.js            # AI chat assistant
│   └── research/
│       └── insights.js    # DeFi protocol analysis
├── agents/                 # Intelligence Agents (for local dev)
│   ├── server.js          # Local development server
│   ├── research/          # Research agent
│   ├── alpha/             # Alpha detection agent
│   └── shared/            # Shared utilities
└── contracts/              # Smart contracts
    ├── evm/               # EVM contracts (Solidity)
    └── solana/            # Solana programs (Rust)
```

## 🛠️ Local Development

### Start Local Server
```bash
cd agents
node server.js
```

Server runs on `http://localhost:3000`

### Open Pages
- Landing: `http://localhost:3000` or open `index.html`
- Research: `http://localhost:3000/research.html`
- Deposit: `http://localhost:3000/deposit-new.html`
- Vault: `http://localhost:3000/vault-new.html`

## 🌐 Vercel Deployment

See [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) for detailed deployment instructions.

**Quick Deploy:**
1. Connect GitHub to Vercel
2. Import project
3. Deploy (auto-detects configuration)

## 🎯 Features

### Research Intelligence Agent
- Real-time DeFi protocol analysis
- TVL tracking and 7-day change metrics
- News aggregation with sentiment analysis
- Trending token discovery
- AI-powered chat assistant

### Multi-Chain Vault
- **EVM Chains**: Ethereum, Polygon, Arbitrum, Optimism, Base
- **Solana**: Native SOL and SPL token support
- **Bitcoin**: Ordinals and BRC-20 integration (coming soon)

### Smart Contract Vault
- Secure multi-asset collateral
- Automated yield strategies
- Agent-managed portfolio optimization
- nUSD stablecoin minting

## 📊 API Endpoints

All API endpoints are available at `/api/`:

- `GET /api/health` - System status
- `GET /api/news` - Latest crypto news
- `GET /api/trending` - Trending tokens
- `GET /api/research/insights?protocols=aave,curve` - Protocol analysis
- `POST /api/chat` - AI chat (body: `{message: "..."}`)

## 🔧 Environment Variables

For enhanced functionality (optional):

```bash
NEWS_API_KEY=your_newsapi_key  # For real news (falls back to mock data)
```

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please open an issue or PR.
