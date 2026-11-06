/**
 * Deposit UI Component for Nexxore Vault
 * Multi-chain deposit interface
 */

import { evmWallet, VaultContract, formatBalance, parseInput } from './wallet/evmWallet.js';
import { solanaWallet, SolanaVaultProgram } from './wallet/solanaWallet.js';
import { btcWallet, BTCDepositTracker } from './wallet/btcWallet.js';

export class DepositUI {
  constructor(config) {
    this.config = config;
    this.selectedChain = 'eth';
    this.selectedAsset = null;
    this.amount = '';
    this.balance = 0n;
    this.listeners = new Set();
    
    this.init();
  }

  init() {
    this.createHTML();
    this.attachEventListeners();
    this.subscribeToWallets();
  }

  createHTML() {
    const container = document.getElementById('deposit-container');
    if (!container) return;

    container.innerHTML = `
      <div class="deposit-card">
        <h2>Deposit Assets</h2>
        
        <!-- Chain Selector -->
        <div class="chain-selector">
          <label>Select Chain</label>
          <div class="chain-buttons">
            <button class="chain-btn active" data-chain="eth">
              <img src="/assets/icons/ethereum.svg" alt="Ethereum" />
              Ethereum
            </button>
            <button class="chain-btn" data-chain="sol">
              <img src="/assets/icons/solana.svg" alt="Solana" />
              Solana
            </button>
            <button class="chain-btn" data-chain="btc">
              <img src="/assets/icons/bitcoin.svg" alt="Bitcoin" />
              Bitcoin
            </button>
          </div>
        </div>

        <!-- Asset Selector -->
        <div class="asset-selector">
          <label>Select Asset</label>
          <select id="asset-select" class="asset-select">
            <option value="">Choose asset...</option>
          </select>
        </div>

        <!-- Amount Input -->
        <div class="amount-input-group">
          <label>
            Amount
            <span class="balance-label" id="balance-label">Balance: --</span>
          </label>
          <div class="input-wrapper">
            <input 
              type="number" 
              id="amount-input" 
              class="amount-input" 
              placeholder="0.0"
              step="0.000001"
            />
            <button class="max-btn" id="max-btn">MAX</button>
          </div>
          <div class="input-hint" id="input-hint"></div>
        </div>

        <!-- Deposit Button -->
        <button 
          id="deposit-btn" 
          class="deposit-btn" 
          disabled
        >
          Connect Wallet to Deposit
        </button>

        <!-- Transaction Status -->
        <div class="tx-status" id="tx-status" style="display: none;">
          <div class="status-icon" id="status-icon"></div>
          <div class="status-message" id="status-message"></div>
        </div>

        <!-- BTC Deposit Address (shown only for BTC) -->
        <div class="btc-deposit-info" id="btc-deposit-info" style="display: none;">
          <h3>Deposit Address</h3>
          <div class="address-display">
            <code id="btc-address"></code>
            <button class="copy-btn" id="copy-btc-address">Copy</button>
          </div>
          <p class="warning">⚠️ Send only Bitcoin to this address. Minimum: 0.0001 BTC</p>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    // Chain selection
    document.querySelectorAll('.chain-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const chain = e.currentTarget.dataset.chain;
        this.selectChain(chain);
      });
    });

    // Asset selection
    const assetSelect = document.getElementById('asset-select');
    assetSelect?.addEventListener('change', (e) => {
      this.selectedAsset = e.target.value;
      this.updateBalance();
      this.updateDepositButton();
    });

    // Amount input
    const amountInput = document.getElementById('amount-input');
    amountInput?.addEventListener('input', (e) => {
      this.amount = e.target.value;
      this.validateAmount();
      this.updateDepositButton();
    });

    // Max button
    document.getElementById('max-btn')?.addEventListener('click', () => {
      this.setMaxAmount();
    });

    // Deposit button
    document.getElementById('deposit-btn')?.addEventListener('click', () => {
      this.executeDeposit();
    });

    // Copy BTC address
    document.getElementById('copy-btc-address')?.addEventListener('click', () => {
      this.copyBTCAddress();
    });
  }

  selectChain(chain) {
    this.selectedChain = chain;
    
    // Update UI
    document.querySelectorAll('.chain-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.chain === chain);
    });

    // Update asset list
    this.updateAssetList();
    
    // Show/hide BTC deposit info
    const btcInfo = document.getElementById('btc-deposit-info');
    if (chain === 'btc' && btcWallet.connected) {
      btcInfo.style.display = 'block';
      document.getElementById('btc-address').textContent = btcWallet.address;
    } else {
      btcInfo.style.display = 'none';
    }

    this.updateDepositButton();
  }

  updateAssetList() {
    const select = document.getElementById('asset-select');
    if (!select) return;

    const assets = {
      eth: [
        { value: 'ETH', label: 'ETH - Ethereum', decimals: 18 },
        { value: 'USDC', label: 'USDC - USD Coin', decimals: 6 },
        { value: 'USDT', label: 'USDT - Tether', decimals: 6 },
      ],
      sol: [
        { value: 'SOL', label: 'SOL - Solana', decimals: 9 },
        { value: 'USDC', label: 'USDC - USD Coin', decimals: 6 },
      ],
      btc: [
        { value: 'BTC', label: 'BTC - Bitcoin', decimals: 8 },
      ],
    };

    select.innerHTML = '<option value="">Choose asset...</option>';
    
    (assets[this.selectedChain] || []).forEach(asset => {
      const option = document.createElement('option');
      option.value = JSON.stringify(asset);
      option.textContent = asset.label;
      select.appendChild(option);
    });

    this.selectedAsset = null;
  }

  async updateBalance() {
    if (!this.selectedAsset) {
      document.getElementById('balance-label').textContent = 'Balance: --';
      return;
    }

    const asset = JSON.parse(this.selectedAsset);
    
    try {
      let balance = 0n;

      if (this.selectedChain === 'eth' && evmWallet.isConnected) {
        balance = await this.getEVMBalance(asset);
      } else if (this.selectedChain === 'sol' && solanaWallet.connected) {
        balance = await this.getSolanaBalance(asset);
      } else if (this.selectedChain === 'btc' && btcWallet.connected) {
        balance = await btcWallet.getBalance();
      }

      this.balance = balance;
      
      const formatted = formatBalance(balance, asset.decimals);
      document.getElementById('balance-label').textContent = 
        `Balance: ${formatted} ${asset.value}`;
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    }
  }

  async getEVMBalance(asset) {
    // Implementation depends on asset type (native vs ERC20)
    // Placeholder
    return 0n;
  }

  async getSolanaBalance(asset) {
    // Implementation for Solana tokens
    // Placeholder
    return 0;
  }

  validateAmount() {
    const hint = document.getElementById('input-hint');
    if (!hint) return;

    if (!this.amount || parseFloat(this.amount) <= 0) {
      hint.textContent = '';
      return false;
    }

    const asset = this.selectedAsset ? JSON.parse(this.selectedAsset) : null;
    if (!asset) return false;

    const inputAmount = parseInput(this.amount, asset.decimals);
    
    if (inputAmount > this.balance) {
      hint.textContent = '❌ Insufficient balance';
      hint.className = 'input-hint error';
      return false;
    }

    hint.textContent = `✓ You will receive ~${this.amount} vault shares`;
    hint.className = 'input-hint success';
    return true;
  }

  setMaxAmount() {
    if (!this.selectedAsset) return;
    
    const asset = JSON.parse(this.selectedAsset);
    const maxAmount = formatBalance(this.balance, asset.decimals);
    
    document.getElementById('amount-input').value = maxAmount;
    this.amount = maxAmount;
    this.validateAmount();
    this.updateDepositButton();
  }

  updateDepositButton() {
    const btn = document.getElementById('deposit-btn');
    if (!btn) return;

    const isConnected = 
      (this.selectedChain === 'eth' && evmWallet.isConnected) ||
      (this.selectedChain === 'sol' && solanaWallet.connected) ||
      (this.selectedChain === 'btc' && btcWallet.connected);

    if (!isConnected) {
      btn.textContent = 'Connect Wallet to Deposit';
      btn.disabled = true;
      return;
    }

    if (this.selectedChain === 'btc') {
      btn.textContent = 'Generate Deposit Address';
      btn.disabled = false;
      return;
    }

    const isValid = this.selectedAsset && 
                    this.amount && 
                    parseFloat(this.amount) > 0 &&
                    this.validateAmount();

    btn.textContent = 'Deposit';
    btn.disabled = !isValid;
  }

  async executeDeposit() {
    if (this.selectedChain === 'btc') {
      await this.executeBTCDeposit();
      return;
    }

    this.showStatus('pending', 'Processing deposit...');

    try {
      const asset = JSON.parse(this.selectedAsset);
      const amount = parseInput(this.amount, asset.decimals);

      let result;

      if (this.selectedChain === 'eth') {
        result = await this.depositEVM(asset, amount);
      } else if (this.selectedChain === 'sol') {
        result = await this.depositSolana(asset, amount);
      }

      if (result.success) {
        this.showStatus('success', `Deposit successful! ${this.amount} ${asset.value} deposited.`);
        this.clearForm();
        this.updateBalance();
      } else {
        throw result.error;
      }
    } catch (error) {
      console.error('Deposit failed:', error);
      this.showStatus('error', `Deposit failed: ${error.message}`);
    }
  }

  async depositEVM(asset, amount) {
    const vaultAddress = this.config.vaults.evm[asset.value];
    const vaultABI = this.config.abis.vault;
    
    const vault = new VaultContract(vaultAddress, vaultABI);
    return await vault.deposit(amount);
  }

  async depositSolana(asset, amount) {
    const programId = this.config.programs.solana;
    const idl = this.config.idls.solana;
    
    const program = new SolanaVaultProgram(programId, idl);
    const tokenMint = this.config.mints.solana[asset.value];
    
    return await program.deposit(solanaWallet.wallet, tokenMint, amount);
  }

  async executeBTCDeposit() {
    const address = await btcWallet.generateDepositAddress();
    
    document.getElementById('btc-address').textContent = address;
    document.getElementById('btc-deposit-info').style.display = 'block';
    
    this.showStatus('info', 'Send BTC to the address above. Deposits will be credited after 3 confirmations.');
  }

  copyBTCAddress() {
    const address = document.getElementById('btc-address').textContent;
    navigator.clipboard.writeText(address);
    
    const btn = document.getElementById('copy-btc-address');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  }

  showStatus(type, message) {
    const status = document.getElementById('tx-status');
    const icon = document.getElementById('status-icon');
    const msg = document.getElementById('status-message');
    
    if (!status || !icon || !msg) return;

    const icons = {
      pending: '⏳',
      success: '✅',
      error: '❌',
      info: 'ℹ️',
    };

    icon.textContent = icons[type] || '';
    msg.textContent = message;
    status.className = `tx-status ${type}`;
    status.style.display = 'block';

    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        status.style.display = 'none';
      }, 5000);
    }
  }

  clearForm() {
    document.getElementById('amount-input').value = '';
    this.amount = '';
    this.validateAmount();
    this.updateDepositButton();
  }

  subscribeToWallets() {
    evmWallet.subscribe(() => {
      this.updateBalance();
      this.updateDepositButton();
    });

    solanaWallet.subscribe(() => {
      this.updateBalance();
      this.updateDepositButton();
    });

    btcWallet.subscribe(() => {
      this.updateBalance();
      this.updateDepositButton();
      this.selectChain(this.selectedChain); // Refresh BTC address display
    });
  }
}
