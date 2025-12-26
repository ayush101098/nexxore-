# Nexxore Vault - Simplified Deposit System

A simple and secure vault for depositing ERC20 tokens (USDT, USDC) and ETH.

## ✅ What's Working

### Smart Contracts
- ✅ **NexxoreVault.sol** - Simplified deposit-only vault contract
  - Deposit ERC20 tokens (USDT, USDC, etc.)
  - Deposit ETH
  - Track user balances
  - All tests passing (9/9)

### Frontend
- ✅ **deposit.html** - Clean deposit interface
  - MetaMask integration
  - Support for ETH, USDT, USDC deposits
  - Automatic token approval flow

### Testing
- ✅ All 9 tests passing
- ✅ Token deposits working
- ✅ ETH deposits working
- ✅ Balance tracking working

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd contracts/evm
npm install
```

### 2. Run Tests
```bash
npx hardhat test
```

### 3. Deploy to Sepolia Testnet

First, create a `.env` file (see `.env.example`):
```bash
cp .env.example .env
```

Edit `.env` and add:
- Your private key (get testnet ETH from [Sepolia Faucet](https://sepoliafaucet.com/))
- Infura API key (get from [Infura](https://infura.io/))
- Etherscan API key (get from [Etherscan](https://etherscan.io/apis))

Deploy:
```bash
npx hardhat run scripts/deploy.js --network sepolia
```

### 4. Update Frontend

After deployment, copy the vault address and update [deposit.html](../../frontend/deposit.html):
```javascript
const VAULT_ADDRESS = 'YOUR_DEPLOYED_ADDRESS_HERE';
```

For Sepolia testnet, also update the token addresses:
```javascript
// Sepolia testnet token addresses
const USDT_ADDRESS = '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06'; // Sepolia USDT
const USDC_ADDRESS = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8'; // Sepolia USDC
```

### 5. Test the Frontend

Open `frontend/deposit.html` in your browser:
- Connect MetaMask (make sure you're on Sepolia network)
- Deposit ETH, USDT, or USDC
- Check your balances

## 📁 File Structure

```
contracts/evm/
├── contracts/
│   └── NexxoreVault.sol       # Main vault contract
├── test/
│   └── NexxoreVault.test.js   # Tests (9/9 passing)
├── scripts/
│   └── deploy.js              # Deployment script
├── hardhat.config.js          # Hardhat configuration
└── .env.example               # Environment variables template

frontend/
└── deposit.html               # Deposit interface
```

## 🔧 Contract Functions

### Deposit Functions
- `depositToken(address token, uint256 amount)` - Deposit ERC20 tokens
- `depositETH()` - Deposit ETH
- `receive()` - Receive ETH directly

### View Functions
- `getUserBalance(address user, address token)` - Get user's balance
- `getTotalDeposits(address token)` - Get total deposits for a token
- `getVaultBalance(address token)` - Get vault's balance

## 🔒 Security Features

- ✅ ReentrancyGuard protection
- ✅ SafeERC20 for token transfers
- ✅ Zero amount validation
- ✅ Owner-only functions (Ownable)

## 📊 Test Results

```
  NexxoreVault
    Token Deposits
      ✔ Should deposit tokens correctly
      ✔ Should handle multiple deposits
      ✔ Should revert on zero amount
    ETH Deposits
      ✔ Should deposit ETH correctly
      ✔ Should receive ETH via receive function
      ✔ Should revert on zero ETH
    View Functions
      ✔ Should return correct user balances
      ✔ Should return correct total deposits
      ✔ Should return correct vault balance

  9 passing (596ms)
```

## 🌐 Supported Networks

- Ethereum Mainnet
- Sepolia Testnet
- Polygon
- Arbitrum
- Base

## 📝 Next Steps

1. **Deploy to Sepolia** - Test on testnet first
2. **Update Frontend** - Add deployed vault address
3. **Test Deposits** - Verify ETH and token deposits work
4. **Add Withdrawals** (future) - Allow users to withdraw funds
5. **Add UI Dashboard** (future) - Show user balances and history
6. **Deploy to Mainnet** (future) - Production deployment

## ⚠️ Important Notes

- **Never commit your `.env` file** - It contains your private key!
- **Test on Sepolia first** - Don't deploy to mainnet until thoroughly tested
- **Get testnet tokens** - Use faucets for Sepolia ETH and tokens
- **Current limitation** - No withdrawal function (deposit-only)

## 🛠️ Development Commands

```bash
# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to local network
npx hardhat run scripts/deploy.js

# Deploy to Sepolia
npx hardhat run scripts/deploy.js --network sepolia

# Verify contract on Etherscan
npx hardhat verify --network sepolia VAULT_ADDRESS
```

## 📚 Resources

- [Hardhat Documentation](https://hardhat.org/docs)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts)
- [ethers.js Documentation](https://docs.ethers.org/v6/)
- [Sepolia Faucet](https://sepoliafaucet.com/)
