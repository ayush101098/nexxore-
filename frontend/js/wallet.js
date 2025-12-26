/**
 * Web3 Wallet Integration for nexxore
 * Handles wallet connection and vault deposits
 */

class WalletManager {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.chainId = null;
    this.connected = false;
    
    // Vault contract addresses (Base Mainnet)
    this.VAULT_ADDRESS = '0x0000000000000000000000000000000000000000'; // TODO: Deploy vault
    this.SUPPORTED_CHAINS = {
      8453: { name: 'Base', rpc: 'https://mainnet.base.org' },
      84532: { name: 'Base Sepolia', rpc: 'https://sepolia.base.org' }
    };
    
    this.init();
  }
  
  async init() {
    // Check if wallet is already connected
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts) => this.handleAccountsChanged(accounts));
      window.ethereum.on('chainChanged', () => window.location.reload());
      
      // Auto-connect if previously connected
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts.length > 0) {
        await this.connect();
      }
    }
  }
  
  async connect() {
    try {
      if (!window.ethereum) {
        alert('Please install MetaMask or another Web3 wallet');
        window.open('https://metamask.io/download/', '_blank');
        return false;
      }
      
      // Request account access
      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      // Get provider and signer
      this.provider = new ethers.providers.Web3Provider(window.ethereum);
      this.signer = this.provider.getSigner();
      this.address = accounts[0];
      
      // Get chain ID
      const network = await this.provider.getNetwork();
      this.chainId = network.chainId;
      
      // Check if on supported chain
      if (!this.SUPPORTED_CHAINS[this.chainId]) {
        await this.switchToBase();
      }
      
      this.connected = true;
      this.updateUI();
      
      console.log('✅ Wallet connected:', this.address);
      return true;
    } catch (error) {
      console.error('❌ Wallet connection failed:', error);
      alert('Failed to connect wallet: ' + error.message);
      return false;
    }
  }
  
  async disconnect() {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.connected = false;
    this.updateUI();
  }
  
  async switchToBase() {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x2105' }], // Base Mainnet
      });
    } catch (switchError) {
      // Chain not added, add it
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x2105',
              chainName: 'Base',
              nativeCurrency: {
                name: 'Ethereum',
                symbol: 'ETH',
                decimals: 18
              },
              rpcUrls: ['https://mainnet.base.org'],
              blockExplorerUrls: ['https://basescan.org']
            }]
          });
        } catch (addError) {
          console.error('Failed to add Base network:', addError);
          throw addError;
        }
      } else {
        throw switchError;
      }
    }
  }
  
  handleAccountsChanged(accounts) {
    if (accounts.length === 0) {
      this.disconnect();
    } else if (accounts[0] !== this.address) {
      this.address = accounts[0];
      this.updateUI();
    }
  }
  
  updateUI() {
    const connectBtn = document.getElementById('connectWalletBtn');
    const walletInfo = document.getElementById('walletInfo');
    
    if (this.connected && this.address) {
      const shortAddress = `${this.address.slice(0, 6)}...${this.address.slice(-4)}`;
      connectBtn.textContent = shortAddress;
      connectBtn.classList.add('connected');
      
      if (walletInfo) {
        walletInfo.style.display = 'block';
        walletInfo.innerHTML = `
          <div class="wallet-connected">
            <span class="status-dot"></span>
            <span>Connected: ${shortAddress}</span>
          </div>
        `;
      }
    } else {
      connectBtn.textContent = 'Connect Wallet';
      connectBtn.classList.remove('connected');
      
      if (walletInfo) {
        walletInfo.style.display = 'none';
      }
    }
  }
  
  async getBalance() {
    if (!this.provider || !this.address) return '0';
    
    try {
      const balance = await this.provider.getBalance(this.address);
      return ethers.utils.formatEther(balance);
    } catch (error) {
      console.error('Failed to get balance:', error);
      return '0';
    }
  }
  
  async deposit(amount) {
    if (!this.connected) {
      alert('Please connect your wallet first');
      return false;
    }
    
    try {
      // Simple vault contract ABI for deposits
      const vaultABI = [
        'function deposit() public payable',
        'function balanceOf(address) public view returns (uint256)',
        'function totalDeposits() public view returns (uint256)'
      ];
      
      const vault = new ethers.Contract(this.VAULT_ADDRESS, vaultABI, this.signer);
      
      // Send deposit transaction
      const tx = await vault.deposit({
        value: ethers.utils.parseEther(amount.toString())
      });
      
      console.log('📤 Deposit transaction sent:', tx.hash);
      
      // Wait for confirmation
      const receipt = await tx.wait();
      console.log('✅ Deposit confirmed:', receipt.transactionHash);
      
      return {
        success: true,
        txHash: receipt.transactionHash,
        amount: amount
      };
    } catch (error) {
      console.error('❌ Deposit failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  async getVaultBalance() {
    if (!this.connected || !this.address) return '0';
    
    try {
      const vaultABI = ['function balanceOf(address) public view returns (uint256)'];
      const vault = new ethers.Contract(this.VAULT_ADDRESS, vaultABI, this.provider);
      const balance = await vault.balanceOf(this.address);
      return ethers.utils.formatEther(balance);
    } catch (error) {
      console.error('Failed to get vault balance:', error);
      return '0';
    }
  }
}

// Global wallet instance
let walletManager;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  walletManager = new WalletManager();
  
  // Connect button handler
  const connectBtn = document.getElementById('connectWalletBtn');
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      if (walletManager.connected) {
        // Show wallet details or disconnect
        showWalletModal();
      } else {
        await walletManager.connect();
      }
    });
  }
  
  // Deposit button handler
  const depositBtn = document.getElementById('depositBtn');
  if (depositBtn) {
    depositBtn.addEventListener('click', () => showDepositModal());
  }
});

function showWalletModal() {
  // Create modal for wallet details
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content wallet-modal">
      <div class="modal-header">
        <h3>Wallet Details</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="wallet-details">
          <div class="detail-row">
            <span class="detail-label">Address:</span>
            <span class="detail-value">${walletManager.address}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Network:</span>
            <span class="detail-value">${walletManager.SUPPORTED_CHAINS[walletManager.chainId]?.name || 'Unknown'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Balance:</span>
            <span class="detail-value" id="walletBalance">Loading...</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Vault Balance:</span>
            <span class="detail-value" id="vaultBalance">Loading...</span>
          </div>
        </div>
        <button class="btn btn-outline" onclick="walletManager.disconnect(); this.closest('.modal-overlay').remove();">
          Disconnect
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Load balances
  walletManager.getBalance().then(balance => {
    document.getElementById('walletBalance').textContent = `${parseFloat(balance).toFixed(4)} ETH`;
  });
  
  walletManager.getVaultBalance().then(balance => {
    document.getElementById('vaultBalance').textContent = `${parseFloat(balance).toFixed(4)} ETH`;
  });
}

function showDepositModal() {
  if (!walletManager.connected) {
    alert('Please connect your wallet first');
    return;
  }
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content deposit-modal">
      <div class="modal-header">
        <h3>Deposit to Vault</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="modal-body">
        <p class="modal-description">Deposit ETH into the yield vault to start earning optimized returns.</p>
        <div class="deposit-input-group">
          <input type="number" id="depositAmount" placeholder="0.0" step="0.01" min="0" class="deposit-input">
          <span class="deposit-currency">ETH</span>
        </div>
        <div class="deposit-info">
          <div class="info-row">
            <span>Available:</span>
            <span id="availableBalance">Loading...</span>
          </div>
          <div class="info-row">
            <span>Expected APY:</span>
            <span class="apy-value">8.5%</span>
          </div>
        </div>
        <button class="btn btn-primary btn-full" onclick="executeDeposit()">
          Deposit
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Load available balance
  walletManager.getBalance().then(balance => {
    document.getElementById('availableBalance').textContent = `${parseFloat(balance).toFixed(4)} ETH`;
  });
}

async function executeDeposit() {
  const amountInput = document.getElementById('depositAmount');
  const amount = parseFloat(amountInput.value);
  
  if (!amount || amount <= 0) {
    alert('Please enter a valid amount');
    return;
  }
  
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Depositing...';
  
  const result = await walletManager.deposit(amount);
  
  if (result.success) {
    alert(`✅ Deposit successful!\n\nAmount: ${result.amount} ETH\nTx: ${result.txHash}`);
    document.querySelector('.modal-overlay').remove();
  } else {
    alert(`❌ Deposit failed: ${result.error}`);
    btn.disabled = false;
    btn.textContent = 'Deposit';
  }
}
