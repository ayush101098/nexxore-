# NexxoreYieldVault Smart Contract

## Overview
Safe yield vault for ETH deposits with optimized yield strategies on Base network.

## Features
- ✅ ETH deposits and withdrawals
- ✅ Yield distribution to depositors
- ✅ Emergency withdraw function
- ✅ Pausable for security
- ✅ Ownership transfer
- ✅ TVL tracking

## Deployment Guide

### Prerequisites
```bash
npm install -g hardhat
npm install @openzeppelin/contracts
```

### Deploy to Base Mainnet

1. **Create deployment script** (`scripts/deploy.js`):
```javascript
const hre = require("hardhat");

async function main() {
  const NexxoreYieldVault = await hre.ethers.getContractFactory("NexxoreYieldVault");
  const vault = await NexxoreYieldVault.deploy();
  
  await vault.deployed();
  
  console.log("✅ NexxoreYieldVault deployed to:", vault.address);
  console.log("📝 Save this address in frontend/js/wallet.js");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

2. **Configure Hardhat** (`hardhat.config.js`):
```javascript
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: "0.8.20",
  networks: {
    base: {
      url: "https://mainnet.base.org",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 8453
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 84532
    }
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY
    }
  }
};
```

3. **Deploy**:
```bash
# Test on Base Sepolia first
npx hardhat run scripts/deploy.js --network baseSepolia

# Production deployment
npx hardhat run scripts/deploy.js --network base
```

4. **Verify contract**:
```bash
npx hardhat verify --network base <CONTRACT_ADDRESS>
```

5. **Update frontend**: Copy deployed address to `frontend/js/wallet.js` line 12

## Quick Deploy (Using Remix)

1. Go to [remix.ethereum.org](https://remix.ethereum.org)
2. Create new file `NexxoreYieldVault.sol`
3. Paste contract code
4. Compile with Solidity 0.8.20
5. Deploy on Base network using MetaMask
6. Copy deployed address to frontend

## Contract Address
- **Base Mainnet**: `TBD`
- **Base Sepolia**: `TBD`

## Security Considerations
- ✅ Reentrancy protection
- ✅ Emergency pause mechanism
- ✅ Emergency withdraw function
- ✅ Owner controls for yield distribution
- ⚠️ Audit recommended before mainnet deployment

## Usage Example

### Deposit ETH
```javascript
await vault.deposit({ value: ethers.utils.parseEther("1.0") });
```

### Withdraw ETH
```javascript
await vault.withdraw(ethers.utils.parseEther("0.5"));
```

### Check Balance
```javascript
const balance = await vault.balanceOf(userAddress);
```

### Get TVL
```javascript
const tvl = await vault.getTVL();
```

## Testing

Create `test/NexxoreYieldVault.test.js`:
```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NexxoreYieldVault", function () {
  let vault;
  let owner;
  let user1;

  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("NexxoreYieldVault");
    vault = await Vault.deploy();
    await vault.deployed();
  });

  it("Should accept deposits", async function () {
    await vault.connect(user1).deposit({ value: ethers.utils.parseEther("1") });
    expect(await vault.balanceOf(user1.address)).to.equal(ethers.utils.parseEther("1"));
  });

  it("Should allow withdrawals", async function () {
    await vault.connect(user1).deposit({ value: ethers.utils.parseEther("1") });
    await vault.connect(user1).withdraw(ethers.utils.parseEther("0.5"));
    expect(await vault.balanceOf(user1.address)).to.equal(ethers.utils.parseEther("0.5"));
  });
});
```

Run tests:
```bash
npx hardhat test
```

## License
MIT
