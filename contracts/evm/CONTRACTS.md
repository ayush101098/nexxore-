# Nexxore EVM Contracts

Complete smart contract infrastructure for the Nexxore protocol.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER                                     │
└─────────────────────────────┬───────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   BaseVault     │ │ CollateralMgr   │ │     nUSD        │
│   (ERC-4626)    │ │                 │ │   (ERC-20)      │
│                 │ │  deposit ETH    │ │                 │
│  deposit()      │ │  mint nUSD      │ │  mint/burn      │
│  withdraw()     │ │  redeem nUSD    │ │  by ColMgr     │
│  redeem()       │ │                 │ │                 │
└────────┬────────┘ └────────┬────────┘ └─────────────────┘
         │                   │
         ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STRATEGY ROUTER                             │
│                                                                  │
│  deployCapital()  │  recallCapital()  │  rebalance()            │
└─────────────────────────────┬───────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ LidoStrategy    │ │ AaveStrategy    │ │ DeltaNeutral    │
│                 │ │                 │ │   Strategy      │
│ ETH → stETH     │ │ USDC → aUSDC    │ │                 │
│ ~4% APY         │ │ ~3% APY         │ │ spot + short    │
└─────────────────┘ └─────────────────┘ │ funding yield   │
                                        └─────────────────┘
```

## Contracts

### Core

| Contract | Description |
|----------|-------------|
| `NUSD.sol` | Overcollateralized stablecoin, only minted/burned by CollateralManager |
| `CollateralManager.sol` | Manages user collateral deposits, nUSD minting, liquidations |
| `StrategyRouter.sol` | Routes collateral to yield-generating strategies |
| `BaseVault.sol` | ERC-4626 compliant vault with multi-strategy support |
| `VaultFactory.sol` | Deploys new vault instances using minimal proxy pattern |

### Strategies

| Contract | Description | Target APY |
|----------|-------------|------------|
| `LidoStakingStrategy.sol` | Stakes ETH in Lido for stETH yield | ~4% |
| `AaveLendingStrategy.sol` | Supplies USDC to Aave v3 | ~3% |
| `DeltaNeutralStrategy.sol` | Spot + short perp for funding yield | ~15-30% |
| `CompoundLendingStrategy.sol` | Supplies to Compound v3 | ~2-4% |

## Deployment

### Prerequisites

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
forge install
```

### Deploy to Testnet (Sepolia)

```bash
# Set environment variables
export PRIVATE_KEY=your_private_key
export RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your-key

# Deploy
forge script scripts/DeployCore.s.sol:DeployCore \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify
```

### Deploy to Mainnet

```bash
export PRIVATE_KEY=your_private_key
export RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your-key

forge script scripts/DeployCore.s.sol:DeployCore \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_KEY
```

## User Flows

### 1. Deposit ETH → Mint nUSD

```solidity
// 1. Deposit ETH as collateral
collateralManager.depositETH{value: 1 ether}();

// 2. Mint nUSD (up to 80% LTV)
// If ETH = $3000, can mint up to $2400 nUSD
collateralManager.mintNUSD(address(0), 2400e18);

// 3. User now has 2400 nUSD
// ETH is deployed to strategies for yield
```

### 2. Redeem nUSD → Get ETH Back

```solidity
// 1. Approve nUSD spending
nusd.approve(address(collateralManager), 2400e18);

// 2. Redeem nUSD for ETH
collateralManager.redeemNUSD(address(0), 2400e18);

// 3. User receives ETH back
```

### 3. Deposit to Vault

```solidity
// 1. Approve asset
usdc.approve(vault, 1000e6);

// 2. Deposit and receive shares
uint256 shares = vault.deposit(1000e6, msg.sender);

// 3. Later, redeem shares for assets + yield
uint256 assets = vault.redeem(shares, msg.sender, msg.sender);
```

## Configuration

### CollateralManager Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxLTV` | 80% | Maximum loan-to-value ratio |
| `liquidationThreshold` | 90% | LTV at which position can be liquidated |
| `liquidationPenalty` | 5% | Penalty applied during liquidation |
| `mintFee` | 0.1% | Fee for minting nUSD |
| `redeemFee` | 0.1% | Fee for redeeming nUSD |

### Vault Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_STRATEGIES` | 10 | Maximum strategies per vault |
| `MAX_STRATEGY_WEIGHT` | 50% | Maximum allocation to single strategy |
| `MIN_REBALANCE_INTERVAL` | 1 hour | Minimum time between rebalances |
| `MAX_PERFORMANCE_FEE` | 10% | Maximum performance fee |

## Testing

```bash
# Run all tests
forge test

# Run with verbosity
forge test -vvv

# Run specific test
forge test --match-test testDeposit

# Gas report
forge test --gas-report
```

## Security

### Access Control

| Role | Permissions |
|------|-------------|
| `DEFAULT_ADMIN` | Full control, fee management |
| `STRATEGIST` | Strategy management, capital allocation |
| `GUARDIAN` | Emergency pause, emergency withdrawals |
| `LIQUIDATOR` | Execute liquidations |

### Invariants

1. `collateral_value >= nUSD_debt` for all positions
2. `total_strategy_weight <= 100%`
3. `strategy_allocation <= strategy_weight * total_assets`

## Addresses

### Mainnet (TBD)

| Contract | Address |
|----------|---------|
| nUSD | - |
| CollateralManager | - |
| StrategyRouter | - |
| VaultFactory | - |

### Sepolia Testnet (TBD)

| Contract | Address |
|----------|---------|
| nUSD | - |
| CollateralManager | - |
| StrategyRouter | - |
| VaultFactory | - |

## External Dependencies

- **OpenZeppelin Contracts v5.0**: Access control, ERC-4626, security
- **Chainlink**: Price feeds for collateral valuation
- **Lido**: stETH for ETH staking strategy
- **Aave v3**: Lending pools for USDC strategy

## License

MIT
