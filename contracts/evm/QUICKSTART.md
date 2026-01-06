# Vault Infrastructure - Quick Start Guide

## Prerequisites

- Node.js v18+
- npm or yarn
- Hardhat installed
- Test ETH (for testnet deployment)

## Installation

```bash
cd contracts/evm
npm install
```

## Running Tests

### Full Test Suite
```bash
npm test
```

### With Gas Reporting
```bash
npm run gas-report
```

### Coverage Report
```bash
npm run test:coverage
```

## Deployment

### Local Development
```bash
# Start local Hardhat node
npx hardhat node

# In another terminal
npm run deploy:local
```

### Sepolia Testnet
```bash
# Set environment variables in .env
SEPOLIA_RPC_URL=your_rpc_url
PRIVATE_KEY=your_private_key
ETHERSCAN_API_KEY=your_api_key

# Deploy
npm run deploy:sepolia
```

### Mainnet (Production)
```bash
# IMPORTANT: Use hardware wallet or secure key management
npm run deploy:mainnet
```

## Post-Deployment

### 1. Verify Contracts

```bash
# Verify BaseVault implementation
npx hardhat verify --network sepolia <IMPLEMENTATION_ADDRESS>

# Verify VaultFactory
npx hardhat verify --network sepolia <FACTORY_ADDRESS> <IMPLEMENTATION_ADDRESS>
```

### 2. Create Your First Vault

```javascript
const { ethers } = require("hardhat");

async function main() {
  const factoryAddress = "YOUR_FACTORY_ADDRESS";
  const usdcAddress = "USDC_TOKEN_ADDRESS";
  
  const factory = await ethers.getContractAt("VaultFactory", factoryAddress);
  
  const tx = await factory.createVault(
    usdcAddress,              // Asset
    "My USDC Vault",          // Name
    "myUSDC",                 // Symbol
    [],                       // Initial strategies (empty)
    []                        // Initial weights (empty)
  );
  
  const receipt = await tx.wait();
  
  // Find VaultCreated event
  const event = receipt.logs.find(
    log => log.fragment && log.fragment.name === "VaultCreated"
  );
  
  const vaultAddress = event.args[0];
  console.log("✓ Vault created:", vaultAddress);
}

main();
```

### 3. Configure Roles

```javascript
const vault = await ethers.getContractAt("BaseVault", vaultAddress);

// Grant strategist role to strategy manager
const STRATEGIST_ROLE = await vault.STRATEGIST_ROLE();
await vault.grantRole(STRATEGIST_ROLE, strategistAddress);

// Grant guardian role to security multisig
const GUARDIAN_ROLE = await vault.GUARDIAN_ROLE();
await vault.grantRole(GUARDIAN_ROLE, guardianAddress);
```

### 4. Add Strategies

```javascript
// Add strategy with 50% allocation
await vault.addStrategy(strategyAddress, 5000);

// Add another strategy with 30% allocation
await vault.addStrategy(strategyAddress2, 3000);

// Remaining 20% stays idle in vault
```

### 5. Enable Deposits

```javascript
// Vault is now ready for user deposits
// Users can call vault.deposit(amount, receiver)
```

## Common Operations

### User Deposits

```javascript
const vault = await ethers.getContractAt("BaseVault", vaultAddress);
const usdc = await ethers.getContractAt("IERC20", usdcAddress);

// Approve vault
await usdc.approve(vaultAddress, depositAmount);

// Deposit and receive shares
const shares = await vault.deposit(depositAmount, userAddress);
```

### Capital Allocation

```javascript
// Allocate 1000 USDC to strategy
await vault.allocateToStrategy(strategyAddress, ethers.parseUnits("1000", 6));

// Withdraw 500 USDC from strategy
await vault.withdrawFromStrategy(strategyAddress, ethers.parseUnits("500", 6));

// Auto-rebalance all strategies to target weights
await vault.rebalance();
```

### Monitoring

```javascript
// Get vault stats
const totalAssets = await vault.totalAssets();
const totalShares = await vault.totalSupply();
const pricePerShare = await vault.convertToAssets(ethers.parseUnits("1", 18));

// Get strategy allocations
const strategies = await vault.getStrategies();
for (const strategy of strategies) {
  const info = await vault.getStrategyInfo(strategy);
  console.log(`Strategy ${strategy}:`);
  console.log(`  Weight: ${info.weight / 100}%`);
  console.log(`  Allocation: ${ethers.formatUnits(info.allocation, 6)} USDC`);
  console.log(`  Target: ${ethers.formatUnits(info.targetAllocation, 6)} USDC`);
}
```

## Emergency Procedures

### Pause Vault
```javascript
// Guardian can pause in case of emergency
await vault.pause();

// Resume when safe
await vault.unpause();
```

### Emergency Withdraw from Strategy
```javascript
// Withdraw all capital from compromised strategy
await vault.emergencyWithdraw(compromisedStrategy);
```

## Testing Checklist

Before mainnet deployment:

- [ ] All unit tests passing
- [ ] Integration tests completed
- [ ] Gas optimization verified (< 150k for deposits)
- [ ] Contract verification on Etherscan
- [ ] Multi-sig configured for admin roles
- [ ] Guardian role assigned to security team
- [ ] Strategy contracts audited
- [ ] TVL limits configured (if applicable)
- [ ] Monitoring dashboards set up
- [ ] Emergency procedures documented

## Support & Resources

- **Documentation**: See `VAULT_ARCHITECTURE.md` for detailed architecture
- **Tests**: Check `test/` directory for comprehensive examples
- **Issues**: Report bugs via GitHub issues
- **Security**: security@nexxore.xyz for responsible disclosure

## Example Scripts

### Monitor All Vaults

```javascript
const factory = await ethers.getContractAt("VaultFactory", factoryAddress);
const vaults = await factory.getActiveVaults();

for (const vaultAddr of vaults) {
  const vault = await ethers.getContractAt("BaseVault", vaultAddr);
  const metadata = await factory.getVaultMetadata(vaultAddr);
  const tvl = await vault.totalAssets();
  
  console.log(`\nVault: ${metadata.name}`);
  console.log(`Address: ${vaultAddr}`);
  console.log(`TVL: ${ethers.formatUnits(tvl, 6)} ${metadata.symbol}`);
  console.log(`Creator: ${metadata.creator}`);
}
```

### Automated Rebalancing Bot

```javascript
async function rebalanceBot() {
  const factory = await ethers.getContractAt("VaultFactory", factoryAddress);
  const vaults = await factory.getActiveVaults();
  
  for (const vaultAddr of vaults) {
    const vault = await ethers.getContractAt("BaseVault", vaultAddr);
    
    try {
      // Attempt rebalance
      const tx = await vault.rebalance();
      await tx.wait();
      console.log(`✓ Rebalanced ${vaultAddr}`);
    } catch (error) {
      if (error.message.includes("RebalanceTooSoon")) {
        console.log(`⏳ ${vaultAddr} not ready for rebalance`);
      } else {
        console.error(`✗ Error rebalancing ${vaultAddr}:`, error.message);
      }
    }
  }
}

// Run every hour
setInterval(rebalanceBot, 3600000);
```

## Next Steps

1. ✅ Deploy contracts to testnet
2. ✅ Create test vault with mock strategies
3. ✅ Test full deposit → allocation → withdrawal flow
4. ✅ Configure proper role management
5. ✅ Set up monitoring and alerts
6. ✅ Audit strategy contracts
7. ✅ Deploy to mainnet with TVL cap
8. ✅ Gradual rollout with increasing limits

## Troubleshooting

### "InsufficientBalance" Error
- Check vault has enough idle balance before allocating
- Verify total allocation doesn't exceed deposits

### "RebalanceTooSoon" Error
- Wait at least 1 hour between rebalances
- Check `lastRebalance` timestamp

### "InvalidWeight" Error
- Ensure total weights ≤ 10000 (100%)
- Individual strategy weight ≤ 5000 (50%)

### Gas Price Too High
- Use gas price oracle
- Consider batching operations
- Wait for lower network congestion

---

**Ready to build? Start with `npm test` to ensure everything works! 🚀**
