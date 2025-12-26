# Nexxore Multi-Chain Vault System

A deterministic, multi-chain vault system supporting Ethereum (EVM), Solana, and Bitcoin.

## 🏗️ Architecture

```
nexxore/
├── contracts/          # Smart contracts
│   ├── evm/           # Solidity contracts (Ethereum, Polygon, Arbitrum, Base)
│   └── solana/        # Anchor programs (Solana)
├── frontend/          # Web interface
├── backend/           # Backend services
│   └── indexer/       # Event indexing & ledger sync
└── database/          # PostgreSQL schema
```

## 🚀 Features

### EPIC 1: Multi-Chain Wallet Connection
- ✅ EVM wallets (MetaMask, Rabby, WalletConnect)
- ✅ Solana wallets (Phantom, Backpack)
- ✅ Bitcoin wallets (Xverse, Unisat) - Receive-only

### EPIC 2: Vault Architecture
- ✅ EVM: ERC-4626-style vaults with share mechanics
- ✅ Solana: Anchor program with PDA vaults
- ✅ Bitcoin: UTXO tracking with manual approvals

### EPIC 3: Deposit Flow
- ✅ Multi-asset support
- ✅ Real-time balance checking
- ✅ Transaction confirmation
- ✅ Event indexing

### EPIC 4: Withdrawal Flow
- ✅ Share-based withdrawals
- ✅ Percentage options (25%, 50%, 75%, 100%)
- ✅ Real-time asset calculation
- ✅ Secure burn & transfer

### EPIC 5: Backend Infrastructure
- ✅ EVM event indexer
- ✅ Solana program log indexer
- ✅ Bitcoin UTXO tracker
- ✅ PostgreSQL ledger
- ✅ Reconciliation system

## 📦 Installation

### Prerequisites
- Node.js 18+
- Rust 1.75+
- PostgreSQL 14+
- Solana CLI
- Anchor Framework

### 1. Install Dependencies

**EVM Contracts:**
```bash
cd contracts/evm
npm install
```

**Solana Program:**
```bash
cd contracts/solana
anchor build
```

**Backend:**
```bash
cd backend
npm install
```

**Frontend:**
```bash
cd frontend
npm install
```

### 2. Database Setup

```bash
# Create database
createdb nexxore

# Run migrations
cd backend
npm run db:migrate
```

### 3. Configure Environment

**Backend** (`backend/.env`):
```bash
cp backend/.env.example backend/.env
# Edit with your values
```

**EVM Contracts** (`contracts/evm/.env`):
```bash
cp contracts/evm/.env.example contracts/evm/.env
# Add your private key and RPC URLs
```

## 🧪 Testing

### EVM Contracts
```bash
cd contracts/evm
npm test
```

### Solana Program
```bash
cd contracts/solana
anchor test
```

## 🚢 Deployment

### 1. Deploy EVM Contracts

```bash
cd contracts/evm

# Testnet (Sepolia)
npm run deploy:sepolia

# Mainnet
npm run deploy:mainnet
```

### 2. Deploy Solana Program

```bash
cd contracts/solana

# Devnet
anchor deploy --provider.cluster devnet

# Mainnet
anchor deploy --provider.cluster mainnet
```

### 3. Start Backend Indexer

```bash
cd backend
npm start
```

### 4. Start Frontend

```bash
cd frontend
npm run dev
```

## 📖 Smart Contract Documentation

### EVM Vault ([NexxoreVault.sol](contracts/evm/NexxoreVault.sol))

**Core Functions:**
- `deposit(uint256 amount)` - Deposit assets, receive shares
- `withdraw(uint256 shares)` - Burn shares, receive assets
- `convertToAssets(uint256 shares)` - Calculate asset value
- `pause()` / `unpause()` - Emergency controls (owner only)

**Events:**
- `Deposit(user, assets, shares, timestamp)`
- `Withdraw(user, assets, shares, timestamp)`

### Solana Vault ([lib.rs](contracts/solana/programs/nexxore-vault/src/lib.rs))

**Instructions:**
- `initialize()` - Create new vault
- `deposit(amount)` - Deposit SPL tokens
- `withdraw(shares)` - Withdraw assets
- `pause()` / `unpause()` - Admin controls

## 🔐 Security

### Best Practices
1. **Vaults are deterministic** - No complex logic in custody contracts
2. **ReentrancyGuard** - All EVM functions protected
3. **Integer overflow checks** - Solana uses checked math
4. **Pausable** - Emergency stop mechanism
5. **Multi-sig** - Bitcoin withdrawals require manual approval

### Audit Checklist
- [ ] Unit tests (100% coverage)
- [ ] Integration tests
- [ ] Fuzz testing (EVM)
- [ ] External security audit
- [ ] Bug bounty program

## 📊 API Endpoints

### Backend Indexer API

**Health Check:**
```
GET /health
```

**Register BTC Address:**
```
POST /api/btc/register
Body: { userAddress, btcAddress }
```

**Get BTC Deposits:**
```
GET /api/btc/deposits/:address
```

**Get User Balance:**
```
GET /api/balance/:chain/:asset/:address
```

**Trigger Reconciliation:**
```
POST /api/reconcile
```

## 🎨 Frontend Components

### Wallet Integration
- [evmWallet.js](frontend/js/wallet/evmWallet.js) - EVM wallet manager
- [solanaWallet.js](frontend/js/wallet/solanaWallet.js) - Solana wallet manager
- [btcWallet.js](frontend/js/wallet/btcWallet.js) - Bitcoin wallet manager

### UI Components
- [depositUI.js](frontend/js/components/depositUI.js) - Deposit interface
- [withdrawUI.js](frontend/js/components/withdrawUI.js) - Withdrawal interface

## 🛠️ Development

### Project Structure
```
contracts/evm/
  ├── NexxoreVault.sol       # Main vault contract
  ├── hardhat.config.js      # Hardhat configuration
  ├── scripts/deploy.js      # Deployment script
  └── test/                  # Contract tests

contracts/solana/
  ├── programs/
  │   └── nexxore-vault/
  │       └── src/lib.rs     # Anchor program
  ├── tests/                 # Program tests
  └── Anchor.toml            # Anchor config

backend/
  ├── indexer/
  │   ├── evmIndexer.js      # EVM event indexer
  │   ├── solanaIndexer.js   # Solana log indexer
  │   ├── btcIndexer.js      # Bitcoin UTXO tracker
  │   └── index.js           # Main service
  └── package.json

frontend/
  ├── vault.html             # Main vault page
  ├── js/
  │   ├── wallet/            # Wallet integrations
  │   └── components/        # UI components
  └── package.json
```

## 📝 License

MIT

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📞 Support

- Documentation: [docs/](docs/)
- Issues: GitHub Issues
- Discord: [Join our community]

## ⚡ Quick Start

```bash
# Clone repository
git clone https://github.com/your-org/nexxore.git
cd nexxore

# Install all dependencies
npm run install:all

# Setup database
npm run db:setup

# Run tests
npm run test:all

# Start development
npm run dev
```

---

**Remember:** 
> "Vaults must be dumb, deterministic, and boring. Intelligence lives in agents, not in custody."

Built with ❤️ by the Nexxore Team
