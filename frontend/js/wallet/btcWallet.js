/**
 * Nexxore Bitcoin Wallet Integration (Receive-Only)
 * Supports Xverse and Unisat wallets
 */

class BitcoinWalletManager {
  constructor() {
    this.address = null;
    this.publicKey = null;
    this.connected = false;
    this.walletType = null;
    this.listeners = new Set();
  }

  async detectWallets() {
    const wallets = [];
    
    // Check for Xverse
    if (window.XverseProviders?.BitcoinProvider) {
      wallets.push('xverse');
    }
    
    // Check for Unisat
    if (window.unisat) {
      wallets.push('unisat');
    }

    return wallets;
  }

  async connect(walletType = 'xverse') {
    try {
      if (walletType === 'xverse') {
        return await this.connectXverse();
      } else if (walletType === 'unisat') {
        return await this.connectUnisat();
      }
      throw new Error('Unsupported wallet type');
    } catch (error) {
      console.error('Failed to connect Bitcoin wallet:', error);
      return false;
    }
  }

  async connectXverse() {
    try {
      if (!window.XverseProviders?.BitcoinProvider) {
        throw new Error('Xverse wallet not installed');
      }

      const provider = window.XverseProviders.BitcoinProvider;
      
      const result = await provider.request('getAccounts', {
        purposes: ['payment', 'ordinals'],
      });

      if (result.status === 'success') {
        const paymentAddress = result.result.find(
          addr => addr.purpose === 'payment'
        );

        this.address = paymentAddress.address;
        this.publicKey = paymentAddress.publicKey;
        this.connected = true;
        this.walletType = 'xverse';
        this.notify();
        return true;
      }

      return false;
    } catch (error) {
      console.error('Xverse connection failed:', error);
      return false;
    }
  }

  async connectUnisat() {
    try {
      if (!window.unisat) {
        throw new Error('Unisat wallet not installed');
      }

      const accounts = await window.unisat.requestAccounts();
      
      if (accounts && accounts.length > 0) {
        this.address = accounts[0];
        this.publicKey = await window.unisat.getPublicKey();
        this.connected = true;
        this.walletType = 'unisat';
        this.notify();
        return true;
      }

      return false;
    } catch (error) {
      console.error('Unisat connection failed:', error);
      return false;
    }
  }

  async disconnect() {
    this.address = null;
    this.publicKey = null;
    this.connected = false;
    this.walletType = null;
    this.notify();
    return true;
  }

  async getBalance() {
    try {
      if (!this.connected) return 0;

      if (this.walletType === 'unisat') {
        const balance = await window.unisat.getBalance();
        return balance.confirmed + balance.unconfirmed;
      } else if (this.walletType === 'xverse') {
        // For Xverse, we need to query balance via API
        return await this.fetchBalanceFromAPI(this.address);
      }

      return 0;
    } catch (error) {
      console.error('Failed to get balance:', error);
      return 0;
    }
  }

  async fetchBalanceFromAPI(address) {
    try {
      // Use a public API like mempool.space or blockstream
      const response = await fetch(
        `https://blockstream.info/api/address/${address}`
      );
      const data = await response.json();
      
      return (data.chain_stats?.funded_txo_sum || 0) - 
             (data.chain_stats?.spent_txo_sum || 0);
    } catch (error) {
      console.error('Failed to fetch balance from API:', error);
      return 0;
    }
  }

  async generateDepositAddress() {
    // For v1, just return the connected address
    // In future versions, could generate new addresses
    return this.address;
  }

  getState() {
    return {
      address: this.address,
      publicKey: this.publicKey,
      connected: this.connected,
      walletType: this.walletType,
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

  getShortAddress() {
    if (!this.address) return '';
    return `${this.address.slice(0, 6)}...${this.address.slice(-4)}`;
  }

  // Utility to convert satoshis to BTC
  satsToBTC(sats) {
    return sats / 100000000;
  }

  // Utility to convert BTC to satoshis
  btcToSats(btc) {
    return Math.floor(btc * 100000000);
  }
}

export const btcWallet = new BitcoinWalletManager();

// ============ Deposit Tracking ============

export class BTCDepositTracker {
  constructor(backendUrl) {
    this.backendUrl = backendUrl;
  }

  async registerDepositAddress(userAddress, btcAddress) {
    try {
      const response = await fetch(`${this.backendUrl}/api/btc/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress, btcAddress }),
      });

      const data = await response.json();
      return data.success;
    } catch (error) {
      console.error('Failed to register BTC address:', error);
      return false;
    }
  }

  async getDepositStatus(btcAddress) {
    try {
      const response = await fetch(
        `${this.backendUrl}/api/btc/deposits/${btcAddress}`
      );
      const data = await response.json();
      return data.deposits || [];
    } catch (error) {
      console.error('Failed to fetch deposit status:', error);
      return [];
    }
  }

  async watchForDeposits(btcAddress, callback) {
    // Poll for new deposits every 30 seconds
    const interval = setInterval(async () => {
      const deposits = await this.getDepositStatus(btcAddress);
      callback(deposits);
    }, 30000);

    return () => clearInterval(interval);
  }
}

// Helper to format BTC amounts
export function formatBTC(satoshis, decimals = 8) {
  const btc = satoshis / 100000000;
  return btc.toFixed(decimals);
}

// Helper to validate Bitcoin address
export function isValidBTCAddress(address) {
  // Basic validation - should be improved
  const patterns = {
    legacy: /^[1][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
    segwit: /^[3][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
    bech32: /^bc1[a-z0-9]{39,59}$/,
  };

  return Object.values(patterns).some(pattern => pattern.test(address));
}
