/**
 * Contract Configuration
 * Auto-generated from deployment
 */

export const CONTRACTS = {
  // Localhost (Hardhat) - Default for development
  localhost: {
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    contracts: {
      USDC: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
      RiskOracle: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
      SafeYieldVault: '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0'
    }
  },
  // Sepolia Testnet
  sepolia: {
    chainId: 11155111,
    rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/',
    contracts: {
      USDC: null,  // Deploy when you have Sepolia ETH
      RiskOracle: null,
      SafeYieldVault: null
    }
  },
  // Ethereum Mainnet (Production)
  mainnet: {
    chainId: 1,
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/',
    contracts: {
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Real USDC
      RiskOracle: null,
      SafeYieldVault: null
    }
  }
};

// Current active network
export const ACTIVE_NETWORK = 'localhost';

// Get current contracts
export function getContracts() {
  return CONTRACTS[ACTIVE_NETWORK].contracts;
}

export function getChainId() {
  return CONTRACTS[ACTIVE_NETWORK].chainId;
}

export function getRpcUrl() {
  return CONTRACTS[ACTIVE_NETWORK].rpcUrl;
}

// Contract ABIs (simplified for frontend)
export const VAULT_ABI = [
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function maxDeposit(address) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
  "function asset() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function mint(address to, uint256 amount)"
];
