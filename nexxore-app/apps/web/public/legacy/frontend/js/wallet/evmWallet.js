/**
 * Nexxore EVM Wallet Integration
 * Supports MetaMask, Rabby, WalletConnect v2
 */

import { createConfig, configureChains, mainnet, sepolia } from '@wagmi/core';
import { publicProvider } from '@wagmi/core/providers/public';
import { 
  EthereumClient, 
  w3mConnectors, 
  w3mProvider 
} from '@web3modal/ethereum';
import { Web3Modal } from '@web3modal/html';

// Chain configuration
const chains = [mainnet, sepolia];
const projectId = 'YOUR_WALLETCONNECT_PROJECT_ID'; // Get from WalletConnect Cloud

// Configure chains & providers
const { publicClient, webSocketPublicClient } = configureChains(chains, [
  w3mProvider({ projectId }),
  publicProvider()
]);

// Create wagmi config
export const wagmiConfig = createConfig({
  autoConnect: true,
  connectors: w3mConnectors({ projectId, chains }),
  publicClient,
  webSocketPublicClient,
});

// Create ethereum client
export const ethereumClient = new EthereumClient(wagmiConfig, chains);

// Create Web3Modal
export const web3Modal = new Web3Modal(
  { projectId },
  ethereumClient
);

// ============ Wallet State Management ============

class EVMWalletManager {
  constructor() {
    this.address = null;
    this.chainId = null;
    this.isConnected = false;
    this.listeners = new Set();
    
    this.init();
  }

  init() {
    // Listen for account changes
    ethereumClient.watchAccount((account) => {
      this.address = account.address;
      this.isConnected = account.isConnected;
      this.chainId = account.connector?.chains?.[0]?.id;
      this.notify();
    });

    // Listen for network changes
    ethereumClient.watchNetwork((network) => {
      this.chainId = network.chain?.id;
      this.notify();
    });

    // Attempt auto-reconnect
    this.reconnect();
  }

  async connect() {
    try {
      await web3Modal.openModal();
      return true;
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      return false;
    }
  }

  async disconnect() {
    try {
      await ethereumClient.disconnect();
      this.address = null;
      this.chainId = null;
      this.isConnected = false;
      this.notify();
      return true;
    } catch (error) {
      console.error('Failed to disconnect:', error);
      return false;
    }
  }

  async reconnect() {
    const account = await ethereumClient.getAccount();
    if (account.isConnected) {
      this.address = account.address;
      this.isConnected = true;
      this.chainId = account.connector?.chains?.[0]?.id;
      this.notify();
    }
  }

  async switchNetwork(chainId) {
    try {
      await ethereumClient.switchNetwork({ chainId });
      return true;
    } catch (error) {
      console.error('Failed to switch network:', error);
      return false;
    }
  }

  getState() {
    return {
      address: this.address,
      chainId: this.chainId,
      isConnected: this.isConnected,
    };
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    const state = this.getState();
    this.listeners.forEach(callback => callback(state));
  }

  // Utility methods
  getShortAddress() {
    if (!this.address) return '';
    return `${this.address.slice(0, 6)}...${this.address.slice(-4)}`;
  }

  getChainName() {
    const chainNames = {
      1: 'Ethereum',
      11155111: 'Sepolia',
      137: 'Polygon',
      42161: 'Arbitrum',
      8453: 'Base',
    };
    return chainNames[this.chainId] || 'Unknown';
  }
}

// Export singleton instance
export const evmWallet = new EVMWalletManager();

// ============ Contract Interaction Helpers ============

import { readContract, writeContract, waitForTransaction } from '@wagmi/core';

export class VaultContract {
  constructor(address, abi) {
    this.address = address;
    this.abi = abi;
  }

  async deposit(amount) {
    try {
      const { hash } = await writeContract({
        address: this.address,
        abi: this.abi,
        functionName: 'deposit',
        args: [amount],
      });

      const receipt = await waitForTransaction({ hash });
      return { success: true, hash, receipt };
    } catch (error) {
      console.error('Deposit failed:', error);
      return { success: false, error };
    }
  }

  async withdraw(shares) {
    try {
      const { hash } = await writeContract({
        address: this.address,
        abi: this.abi,
        functionName: 'withdraw',
        args: [shares],
      });

      const receipt = await waitForTransaction({ hash });
      return { success: true, hash, receipt };
    } catch (error) {
      console.error('Withdrawal failed:', error);
      return { success: false, error };
    }
  }

  async getShares(userAddress) {
    try {
      const shares = await readContract({
        address: this.address,
        abi: this.abi,
        functionName: 'shares',
        args: [userAddress],
      });
      return shares;
    } catch (error) {
      console.error('Failed to fetch shares:', error);
      return 0n;
    }
  }

  async convertToAssets(shares) {
    try {
      const assets = await readContract({
        address: this.address,
        abi: this.abi,
        functionName: 'convertToAssets',
        args: [shares],
      });
      return assets;
    } catch (error) {
      console.error('Failed to convert to assets:', error);
      return 0n;
    }
  }

  async getTotalAssets() {
    try {
      const total = await readContract({
        address: this.address,
        abi: this.abi,
        functionName: 'totalAssets',
      });
      return total;
    } catch (error) {
      console.error('Failed to fetch total assets:', error);
      return 0n;
    }
  }
}

// ============ UI Helper Functions ============

export function formatAddress(address) {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatBalance(balance, decimals = 18) {
  if (!balance) return '0';
  const value = Number(balance) / Math.pow(10, decimals);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function parseInput(value, decimals = 18) {
  const num = parseFloat(value);
  if (isNaN(num)) return 0n;
  return BigInt(Math.floor(num * Math.pow(10, decimals)));
}
