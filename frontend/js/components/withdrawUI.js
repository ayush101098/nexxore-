/**
 * Withdrawal UI Component for Nexxore Vault
 * Multi-chain withdrawal interface
 */

import { evmWallet, VaultContract, formatBalance, parseInput } from './wallet/evmWallet.js';
import { solanaWallet, SolanaVaultProgram } from './wallet/solanaWallet.js';

export class WithdrawUI {
  constructor(config) {
    this.config = config;
    this.selectedChain = 'eth';
    this.selectedAsset = null;
    this.shares = '';
    this.userShares = 0n;
    this.estimatedAssets = 0n;
    this.listeners = new Set();
    
    this.init();
  }

  init() {
    this.createHTML();
    this.attachEventListeners();
    this.subscribeToWallets();
  }

  createHTML() {
    const container = document.getElementById('withdraw-container');
    if (!container) return;

    container.innerHTML = `
      <div class="withdraw-card">
        <h2>Withdraw Assets</h2>
        
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
          </div>
          <p class="note">Note: Bitcoin withdrawals require manual approval (coming soon)</p>
        </div>

        <!-- Asset Selector -->
        <div class="asset-selector">
          <label>Select Asset</label>
          <select id="withdraw-asset-select" class="asset-select">
            <option value="">Choose asset...</option>
          </select>
        </div>

        <!-- Shares Display -->
        <div class="shares-display">
          <div class="shares-row">
            <span>Your Vault Shares:</span>
            <span id="user-shares" class="shares-value">--</span>
          </div>
          <div class="shares-row">
            <span>≈ Assets Value:</span>
            <span id="assets-value" class="assets-value">--</span>
          </div>
        </div>

        <!-- Withdrawal Amount -->
        <div class="amount-input-group">
          <label>
            Shares to Withdraw
            <span class="balance-label">Enter amount or %</span>
          </label>
          <div class="input-wrapper">
            <input 
              type="number" 
              id="withdraw-amount-input" 
              class="amount-input" 
              placeholder="0.0"
              step="0.000001"
            />
            <button class="max-btn" id="withdraw-max-btn">100%</button>
          </div>
          
          <!-- Percentage Buttons -->
          <div class="percentage-buttons">
            <button class="pct-btn" data-pct="25">25%</button>
            <button class="pct-btn" data-pct="50">50%</button>
            <button class="pct-btn" data-pct="75">75%</button>
          </div>
          
          <div class="input-hint" id="withdraw-hint"></div>
        </div>

        <!-- Estimated Receive -->
        <div class="estimated-receive">
          <h3>You will receive:</h3>
          <div class="receive-amount" id="receive-amount">
            <span class="amount">0.00</span>
            <span class="symbol" id="receive-symbol">--</span>
          </div>
        </div>

        <!-- Withdraw Button -->
        <button 
          id="withdraw-btn" 
          class="withdraw-btn" 
          disabled
        >
          Connect Wallet to Withdraw
        </button>

        <!-- Transaction Status -->
        <div class="tx-status" id="withdraw-tx-status" style="display: none;">
          <div class="status-icon" id="withdraw-status-icon"></div>
          <div class="status-message" id="withdraw-status-message"></div>
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
    const assetSelect = document.getElementById('withdraw-asset-select');
    assetSelect?.addEventListener('change', (e) => {
      this.selectedAsset = e.target.value;
      this.updateShares();
      this.updateWithdrawButton();
    });

    // Amount input
    const amountInput = document.getElementById('withdraw-amount-input');
    amountInput?.addEventListener('input', (e) => {
      this.shares = e.target.value;
      this.calculateEstimate();
      this.validateAmount();
      this.updateWithdrawButton();
    });

    // Percentage buttons
    document.querySelectorAll('.pct-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const pct = parseInt(e.target.dataset.pct);
        this.setPercentage(pct);
      });
    });

    // Max button
    document.getElementById('withdraw-max-btn')?.addEventListener('click', () => {
      this.setPercentage(100);
    });

    // Withdraw button
    document.getElementById('withdraw-btn')?.addEventListener('click', () => {
      this.executeWithdraw();
    });
  }

  selectChain(chain) {
    this.selectedChain = chain;
    
    document.querySelectorAll('.chain-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.chain === chain);
    });

    this.updateAssetList();
    this.updateWithdrawButton();
  }

  updateAssetList() {
    const select = document.getElementById('withdraw-asset-select');
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

  async updateShares() {
    if (!this.selectedAsset) {
      document.getElementById('user-shares').textContent = '--';
      document.getElementById('assets-value').textContent = '--';
      return;
    }

    const asset = JSON.parse(this.selectedAsset);
    
    try {
      let shares = 0n;
      let assets = 0n;

      if (this.selectedChain === 'eth' && evmWallet.isConnected) {
        const result = await this.getEVMShares(asset);
        shares = result.shares;
        assets = result.assets;
      } else if (this.selectedChain === 'sol' && solanaWallet.connected) {
        const result = await this.getSolanaShares(asset);
        shares = result.shares;
        assets = result.assets;
      }

      this.userShares = shares;
      
      document.getElementById('user-shares').textContent = 
        formatBalance(shares, asset.decimals);
      document.getElementById('assets-value').textContent = 
        `${formatBalance(assets, asset.decimals)} ${asset.value}`;
    } catch (error) {
      console.error('Failed to fetch shares:', error);
    }
  }

  async getEVMShares(asset) {
    const vaultAddress = this.config.vaults.evm[asset.value];
    const vaultABI = this.config.abis.vault;
    
    const vault = new VaultContract(vaultAddress, vaultABI);
    const shares = await vault.getShares(evmWallet.address);
    const assets = await vault.convertToAssets(shares);
    
    return { shares, assets };
  }

  async getSolanaShares(asset) {
    const programId = this.config.programs.solana;
    const idl = this.config.idls.solana;
    const tokenMint = this.config.mints.solana[asset.value];
    
    const program = new SolanaVaultProgram(programId, idl);
    const shares = await program.getUserShares(solanaWallet.publicKey, tokenMint);
    
    // Calculate assets (would need vault info)
    const vaultInfo = await program.getVaultInfo(tokenMint);
    const assets = vaultInfo.totalShares > 0
      ? (shares * vaultInfo.totalAssets) / vaultInfo.totalShares
      : 0;
    
    return { shares, assets };
  }

  setPercentage(pct) {
    if (!this.selectedAsset || this.userShares === 0n) return;
    
    const asset = JSON.parse(this.selectedAsset);
    const amount = (this.userShares * BigInt(pct)) / 100n;
    const formatted = formatBalance(amount, asset.decimals);
    
    document.getElementById('withdraw-amount-input').value = formatted;
    this.shares = formatted;
    this.calculateEstimate();
    this.validateAmount();
    this.updateWithdrawButton();
  }

  async calculateEstimate() {
    if (!this.shares || !this.selectedAsset) {
      document.querySelector('.receive-amount .amount').textContent = '0.00';
      return;
    }

    const asset = JSON.parse(this.selectedAsset);
    const shareAmount = parseInput(this.shares, asset.decimals);
    
    try {
      let assets = 0n;

      if (this.selectedChain === 'eth' && evmWallet.isConnected) {
        const vaultAddress = this.config.vaults.evm[asset.value];
        const vault = new VaultContract(vaultAddress, this.config.abis.vault);
        assets = await vault.convertToAssets(shareAmount);
      } else if (this.selectedChain === 'sol' && solanaWallet.connected) {
        // Calculate from vault info
        const programId = this.config.programs.solana;
        const idl = this.config.idls.solana;
        const tokenMint = this.config.mints.solana[asset.value];
        const program = new SolanaVaultProgram(programId, idl);
        const vaultInfo = await program.getVaultInfo(tokenMint);
        
        if (vaultInfo.totalShares > 0) {
          assets = (shareAmount * vaultInfo.totalAssets) / vaultInfo.totalShares;
        }
      }

      this.estimatedAssets = assets;
      
      const formatted = formatBalance(assets, asset.decimals);
      document.querySelector('.receive-amount .amount').textContent = formatted;
      document.getElementById('receive-symbol').textContent = asset.value;
    } catch (error) {
      console.error('Failed to calculate estimate:', error);
    }
  }

  validateAmount() {
    const hint = document.getElementById('withdraw-hint');
    if (!hint) return;

    if (!this.shares || parseFloat(this.shares) <= 0) {
      hint.textContent = '';
      return false;
    }

    const asset = this.selectedAsset ? JSON.parse(this.selectedAsset) : null;
    if (!asset) return false;

    const shareAmount = parseInput(this.shares, asset.decimals);
    
    if (shareAmount > this.userShares) {
      hint.textContent = '❌ Insufficient shares';
      hint.className = 'input-hint error';
      return false;
    }

    hint.textContent = '✓ Valid withdrawal amount';
    hint.className = 'input-hint success';
    return true;
  }

  updateWithdrawButton() {
    const btn = document.getElementById('withdraw-btn');
    if (!btn) return;

    const isConnected = 
      (this.selectedChain === 'eth' && evmWallet.isConnected) ||
      (this.selectedChain === 'sol' && solanaWallet.connected);

    if (!isConnected) {
      btn.textContent = 'Connect Wallet to Withdraw';
      btn.disabled = true;
      return;
    }

    const isValid = this.selectedAsset && 
                    this.shares && 
                    parseFloat(this.shares) > 0 &&
                    this.validateAmount();

    btn.textContent = 'Withdraw';
    btn.disabled = !isValid;
  }

  async executeWithdraw() {
    this.showStatus('pending', 'Processing withdrawal...');

    try {
      const asset = JSON.parse(this.selectedAsset);
      const shareAmount = parseInput(this.shares, asset.decimals);

      let result;

      if (this.selectedChain === 'eth') {
        result = await this.withdrawEVM(asset, shareAmount);
      } else if (this.selectedChain === 'sol') {
        result = await this.withdrawSolana(asset, shareAmount);
      }

      if (result.success) {
        this.showStatus('success', `Withdrawal successful! ${formatBalance(this.estimatedAssets, asset.decimals)} ${asset.value} received.`);
        this.clearForm();
        this.updateShares();
      } else {
        throw result.error;
      }
    } catch (error) {
      console.error('Withdrawal failed:', error);
      this.showStatus('error', `Withdrawal failed: ${error.message}`);
    }
  }

  async withdrawEVM(asset, shareAmount) {
    const vaultAddress = this.config.vaults.evm[asset.value];
    const vaultABI = this.config.abis.vault;
    
    const vault = new VaultContract(vaultAddress, vaultABI);
    return await vault.withdraw(shareAmount);
  }

  async withdrawSolana(asset, shareAmount) {
    const programId = this.config.programs.solana;
    const idl = this.config.idls.solana;
    const tokenMint = this.config.mints.solana[asset.value];
    
    const program = new SolanaVaultProgram(programId, idl);
    return await program.withdraw(solanaWallet.wallet, tokenMint, shareAmount);
  }

  showStatus(type, message) {
    const status = document.getElementById('withdraw-tx-status');
    const icon = document.getElementById('withdraw-status-icon');
    const msg = document.getElementById('withdraw-status-message');
    
    if (!status || !icon || !msg) return;

    const icons = {
      pending: '⏳',
      success: '✅',
      error: '❌',
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
    document.getElementById('withdraw-amount-input').value = '';
    this.shares = '';
    this.estimatedAssets = 0n;
    this.calculateEstimate();
    this.validateAmount();
    this.updateWithdrawButton();
  }

  subscribeToWallets() {
    evmWallet.subscribe(() => {
      this.updateShares();
      this.updateWithdrawButton();
    });

    solanaWallet.subscribe(() => {
      this.updateShares();
      this.updateWithdrawButton();
    });
  }
}
