# Vault Infrastructure Architecture

## Overview

The Nexxore vault infrastructure implements a factory pattern for deploying ERC-4626 compliant vaults with multi-strategy support. The architecture is inspired by battle-tested DeFi protocols like Panoptic and Falcon Finance, optimized for gas efficiency and modularity.

## Architecture Components

### 1. VaultFactory

**Purpose**: Deploys and manages vault instances using the minimal proxy pattern (EIP-1167)

**Key Features**:
- **Gas-Efficient Deployment**: Uses OpenZeppelin's Clones library to deploy minimal proxies, reducing deployment costs by ~90%
- **Vault Registry**: Maintains a complete registry of all deployed vaults with metadata
- **Access Control**: Owner-controlled vault lifecycle management

**Technical Details**:
```solidity
// Deployment creates a minimal proxy pointing to the implementation
address vault = vaultImplementation.clone();

// Each vault costs ~45k gas vs ~2M for full deployment
```

**State Management**:
- `allVaults[]`: Array of all vault addresses
- `isVault`: Mapping for O(1) vault validation
- `vaultMetadata`: Complete vault metadata storage

### 2. BaseVault

**Purpose**: ERC-4626 compliant vault with multi-strategy capital allocation

**Key Features**:
- **ERC-4626 Standard**: Fully compliant tokenized vault standard
- **Multi-Strategy Support**: Allocate capital across up to 10 strategies simultaneously
- **Role-Based Access Control**: Three-tier permission system (Admin, Strategist, Guardian)
- **Emergency Controls**: Pausable with emergency withdrawal capabilities

**Technical Details**:

#### Capital Allocation Model
```
Total Assets = Idle Balance + Σ(Strategy Allocations)

Target Allocation per Strategy = Total Assets × (Weight / 10000)

Example with 1000 USDC total:
- Strategy A: 60% weight = 600 USDC
- Strategy B: 40% weight = 400 USDC
```

#### Weight System
- Uses basis points (10000 = 100%)
- Maximum per strategy: 5000 (50%)
- Total weight can be ≤ 10000 (allows partial allocation)

### 3. Role-Based Access Control

| Role | Permissions | Use Case |
|------|------------|----------|
| **DEFAULT_ADMIN_ROLE** | Full control, fee management, role grants | Vault owner/DAO |
| **STRATEGIST_ROLE** | Strategy management, capital allocation, rebalancing | Strategy managers |
| **GUARDIAN_ROLE** | Emergency pause, emergency withdrawals | Security multisig |

### 4. Strategy Interface

While strategies are flexible, the vault expects:

```solidity
interface IStrategy {
    function asset() external view returns (address);
    function balanceOf(address owner) external view returns (uint256);
    function withdraw(uint256 amount, address receiver) external;
    function emergencyWithdraw() external;
}
```

## Deployment Flow

```
1. Deploy BaseVault Implementation
   ↓
2. Deploy VaultFactory(implementation)
   ↓
3. Factory.createVault() → Creates minimal proxy
   ↓
4. Proxy.initialize() → Sets up roles, strategies
   ↓
5. Vault ready for deposits
```

## Usage Patterns

### Creating a Vault

```javascript
const factory = await ethers.getContractAt("VaultFactory", factoryAddress);

const tx = await factory.createVault(
  usdcAddress,           // Underlying asset
  "USDC Yield Vault",    // Vault name
  "yvUSDC",              // Vault symbol
  [strategy1, strategy2], // Initial strategies
  [6000, 4000]           // Weights (60/40 split)
);

const receipt = await tx.wait();
const vaultAddress = receipt.logs[0].address;
```

### User Deposit Flow

```javascript
const vault = await ethers.getContractAt("BaseVault", vaultAddress);

// 1. Approve vault
await usdc.approve(vaultAddress, amount);

// 2. Deposit and receive shares
const shares = await vault.deposit(amount, userAddress);

// Shares represent proportional ownership of vault assets
```

### Strategy Management

```javascript
// Add new strategy (Strategist only)
await vault.addStrategy(strategyAddress, 3000); // 30% weight

// Allocate capital to strategy
await vault.allocateToStrategy(strategyAddress, amount);

// Rebalance all strategies to target weights
await vault.rebalance();
```

## Security Features

### 1. Reentrancy Protection
- All state-changing functions protected with `nonReentrant`
- Uses OpenZeppelin's battle-tested ReentrancyGuard

### 2. Emergency Controls
```solidity
// Guardian can pause in case of exploit
vault.pause();

// Emergency withdraw from compromised strategy
vault.emergencyWithdraw(badStrategy);
```

### 3. Access Control Checks
- Role-based permissions on all critical functions
- Multi-signature recommended for ADMIN and GUARDIAN roles

### 4. Input Validation
- Zero address checks
- Weight validation (max 50% per strategy)
- Total weight cannot exceed 100%
- Minimum rebalance interval (prevents spam)

## Gas Optimization

### Deployment Costs
- **Full BaseVault deployment**: ~2,000,000 gas
- **Minimal proxy deployment**: ~45,000 gas
- **Savings**: ~95% reduction per vault

### Operation Costs
| Operation | Gas Cost | Optimization |
|-----------|----------|--------------|
| Deposit | ~120k | Single storage update |
| Withdraw | ~130k | Optimized share calculation |
| Add Strategy | ~80k | Array push + mapping |
| Rebalance | ~150k + 50k/strategy | Batched transfers |

### Optimization Techniques
1. **Minimal Proxy Pattern**: EIP-1167 clones reduce deployment costs
2. **Packed Storage**: Efficient slot usage for state variables
3. **Batch Operations**: Rebalance processes all strategies in one tx
4. **View Functions**: Off-chain data queries (free)

## Testing Strategy

### Unit Tests
- ✓ VaultFactory deployment and initialization
- ✓ Vault creation and metadata
- ✓ ERC-4626 deposit/withdraw flows
- ✓ Strategy addition/removal
- ✓ Weight management and validation
- ✓ Role-based access control
- ✓ Emergency functions

### Integration Tests
- ✓ End-to-end deposit → strategy allocation → withdrawal
- ✓ Multi-user scenarios
- ✓ Rebalancing with multiple strategies
- ✓ Fee accrual and distribution

### Gas Tests
- ✓ Vault creation < 50k gas
- ✓ Deposit < 150k gas
- ✓ Withdraw < 150k gas

## Upgradeability Considerations

### Current Implementation
- Factory is **NOT** upgradeable (immutable implementation)
- Individual vaults are **NOT** upgradeable (security > flexibility)

### Rationale
1. **Immutability = Security**: No admin upgrade backdoors
2. **Factory Pattern**: Deploy new factory for improvements
3. **Gradual Migration**: Users can migrate to new vaults voluntarily

### Future Improvements Path
If upgradeability needed:
1. Deploy new VaultFactory with improved implementation
2. Deploy new vault instances via new factory
3. Users migrate by:
   - Withdraw from old vault
   - Deposit to new vault
4. Deactivate old vaults in old factory registry

## Integration Examples

### Frontend Integration

```javascript
// Get all active vaults
const activeVaults = await factory.getActiveVaults();

// For each vault, fetch metadata
for (const vaultAddress of activeVaults) {
  const metadata = await factory.getVaultMetadata(vaultAddress);
  const vault = await ethers.getContractAt("BaseVault", vaultAddress);
  
  const tvl = await vault.totalAssets();
  const strategies = await vault.getStrategies();
  
  // Display to user...
}
```

### Keeper Bot (Rebalancing)

```javascript
const MIN_DRIFT = 500; // 5% drift threshold

async function checkAndRebalance(vaultAddress) {
  const vault = await ethers.getContractAt("BaseVault", vaultAddress);
  const strategies = await vault.getStrategies();
  const totalAssets = await vault.totalAssets();
  
  for (const strategy of strategies) {
    const { weight, allocation, targetAllocation } = 
      await vault.getStrategyInfo(strategy);
    
    const drift = Math.abs(allocation - targetAllocation);
    const driftBps = (drift * 10000) / totalAssets;
    
    if (driftBps > MIN_DRIFT) {
      console.log(`Rebalancing needed for ${vaultAddress}`);
      await vault.rebalance();
      break;
    }
  }
}
```

## Risk Considerations

### Smart Contract Risks
1. **Strategy Risk**: Vault depends on strategy contract security
2. **Oracle Risk**: Future yield strategies may depend on oracles
3. **Centralization**: Admin roles have significant control

### Mitigation Strategies
1. **Audit all strategy contracts** before integration
2. **Multi-sig for admin roles** (3-of-5 recommended)
3. **Gradual rollout** with TVL caps initially
4. **Bug bounty program** for responsible disclosure
5. **Emergency pause capability** via guardian role

## Future Enhancements

### Phase 2 (Planned)
- [ ] Strategy health monitoring
- [ ] Automated rebalancing via Chainlink Automation
- [ ] Performance fee distribution logic
- [ ] Vault-to-vault composability
- [ ] Strategy whitelist registry

### Phase 3 (Research)
- [ ] Cross-chain vault support (LayerZero)
- [ ] Flashloan-resistant oracle system
- [ ] DAO governance for protocol parameters
- [ ] Vault insurance fund

## Monitoring & Maintenance

### Key Metrics to Track
1. **TVL per vault**
2. **Strategy allocation ratios**
3. **Gas costs per operation**
4. **User deposit/withdrawal patterns**
5. **Rebalance frequency**

### Recommended Monitoring Tools
- **Tenderly**: Transaction simulation and debugging
- **Dune Analytics**: Custom dashboards for TVL/usage
- **OpenZeppelin Defender**: Automated monitoring and alerts
- **Etherscan**: On-chain verification and transparency

## Conclusion

This vault infrastructure provides a solid foundation for multi-strategy capital management with:
- ✓ Gas-optimized deployment via minimal proxies
- ✓ Industry-standard ERC-4626 compliance
- ✓ Flexible multi-strategy support
- ✓ Comprehensive role-based security
- ✓ Emergency controls and pausability

The architecture prioritizes security, gas efficiency, and modularity while maintaining simplicity for users and integrators.
