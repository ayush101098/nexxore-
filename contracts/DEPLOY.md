# Quick Deploy Guide

## Option 1: Using Remix (Easiest)

1. Go to https://remix.ethereum.org
2. Create new file `NexxoreYieldVault.sol`
3. Copy contract from `contracts/NexxoreYieldVault.sol`
4. Compile with Solidity 0.8.20
5. Connect MetaMask to Base network
6. Deploy the contract
7. Copy deployed address
8. Update `frontend/js/wallet.js` line 12 with the address

## Option 2: Using Hardhat (Recommended for Production)

### Setup
```bash
npm init -y
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
npm install @openzeppelin/contracts dotenv
npx hardhat init
```

### Create .env
```
PRIVATE_KEY=your_wallet_private_key
BASESCAN_API_KEY=your_basescan_api_key
```

### Configure Hardhat
Create `hardhat.config.js`:
```javascript
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: "0.8.20",
  networks: {
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 84532
    },
    base: {
      url: "https://mainnet.base.org",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 8453
    }
  }
};
```

### Deploy
```bash
# Test on Base Sepolia first
npx hardhat run contracts/deploy.js --network baseSepolia

# Production
npx hardhat run contracts/deploy.js --network base
```

## After Deployment

1. Copy the contract address
2. Update `frontend/js/wallet.js`:
   ```javascript
   this.VAULT_ADDRESS = '0xYourDeployedAddress';
   ```
3. Test deposit functionality on your site
4. Monitor deposits at https://basescan.org

## Base Network Details

- **Base Mainnet**: Chain ID 8453
- **Base Sepolia**: Chain ID 84532
- **RPC**: https://mainnet.base.org
- **Explorer**: https://basescan.org

## Get Testnet ETH

For Base Sepolia testing:
1. Get Sepolia ETH from https://sepoliafaucet.com
2. Bridge to Base Sepolia at https://bridge.base.org
