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
    this.VAULT_ADDRESS = '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4'; // Deployed vault
    this.SUPPORTED_CHAINS = {
      8453: { name: 'Base', rpc: 'https://mainnet.base.org' },
      84532: { name: 'Base Sepolia', rpc: 'https://sepolia.base.org' }
    };
    
    this.init();
  }
  
  async init() {
    // Wait for page to fully load
    if (typeof window.ethereum !== 'undefined') {
      try {
        window.ethereum.on('accountsChanged', (accounts) => this.handleAccountsChanged(accounts));
        window.ethereum.on('chainChanged', () => window.location.reload());
        
        // Auto-connect if previously connected
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
          await this.connect();
        }
      } catch (error) {
        console.log('Wallet init error:', error);
      }
    }
  }
  
  async connect() {
    try {
      if (typeof window.ethereum === 'undefined') {
        alert('🦊 Please install MetaMask to connect your wallet!\n\nMetaMask is a browser extension that allows you to interact with blockchain applications.');
        window.open('https://metamask.io/download/', '_blank');
        return false;
      }

      if (typeof ethers === 'undefined') {
        console.error('Ethers library not loaded');
        alert('Error: Web3 library not loaded. Please refresh the page.');
        return false;
      }
      
      // Request account access
      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      if (!accounts || accounts.length === 0) {
        alert('No accounts found. Please unlock MetaMask.');
        return false;
      }
      
      // Get provider and signer
      this.provider = new ethers.providers.Web3Provider(window.ethereum);
      this.signer = this.provider.getSigner();
      this.address = accounts[0];
      
      // Get chain ID
      const network = await this.provider.getNetwork();
      this.chainId = network.chainId;
      
      // Check if on supported chain (optional - comment out if you want to allow any chain for testing)
      // if (!this.SUPPORTED_CHAINS[this.chainId]) {
      //   await this.switchToBase();
      // }
      
      this.connected = true;
      this.updateUI();
      
      console.log('✅ Wallet connected:', this.address);
      console.log('📡 Network:', this.chainId);
      return true;
    } catch (error) {
      console.error('❌ Wallet connection failed:', error);
      
      if (error.code === 4001) {
        alert('Connection rejected. Please approve the connection in MetaMask.');
      } else {
        alert('Failed to connect wallet: ' + error.message);
      }
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
    if (!connectBtn) {
      console.warn('Connect button not found');
      return;
    }
    
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
      alert('⚠️ Please connect your wallet first');
      return false;
    }

    // Check if vault is deployed
    if (this.VAULT_ADDRESS === '0x0000000000000000000000000000000000000000') {
      alert('⚠️ Vault contract not deployed yet!\n\nPlease deploy the vault contract first using Remix.\nSee contracts/DEPLOY.md for instructions.');
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
      console.log('💰 Sending deposit:', amount, 'ETH');
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
      
      let errorMsg = error.message;
      if (error.code === 'INSUFFICIENT_FUNDS') {
        errorMsg = 'Insufficient funds in your wallet';
      } else if (error.code === 4001) {
        errorMsg = 'Transaction rejected by user';
      }
      
      return {
        success: false,
        error: errorMsg
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

// Initialize wallet manager immediately
function initWallet() {
  console.log('🚀 Initializing wallet manager...');
  
  // Check if ethers is loaded
  if (typeof ethers === 'undefined') {
    console.error('❌ Ethers.js not loaded! Make sure the CDN script is included.');
    setTimeout(initWallet, 100); // Retry after 100ms
    return;
  }
  
  walletManager = new WalletManager();
  
  // Connect button handler
  const connectBtn = document.getElementById('connectWalletBtn');
  if (connectBtn) {
    connectBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      console.log('Connect button clicked, connected:', walletManager.connected);
      
      if (walletManager.connected) {
        // Show wallet details or disconnect
        showWalletModal();
      } else {
        await walletManager.connect();
      }
    });
    console.log('✅ Connect button listener added');
  } else {
    console.warn('⚠️ Connect wallet button not found');
  }
  
  console.log('✅ Wallet manager initialized');
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWallet);
} else {
  // DOM already loaded
  initWallet();
}

function showWalletModal() {
  // Remove existing modals
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();
  
  // Create modal for wallet details
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content wallet-modal">
      <div class="modal-header">
        <h3>Wallet Details</h3>
        <button class="modal-close" data-action="close">×</button>
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
        <div class="wallet-actions">
          <button class="btn btn-primary btn-full" data-action="deposit">
            💰 Deposit to Vault
          </button>
          <button class="btn btn-outline btn-full" style="margin-top: 12px;" data-action="disconnect">
            Disconnect
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add event listeners using delegation
  modal.addEventListener('click', (e) => {
    const action = e.target.getAttribute('data-action');
    if (action === 'close') {
      modal.remove();
    } else if (action === 'deposit') {
      modal.remove();
      showDepositModal();
    } else if (action === 'disconnect') {
      walletManager.disconnect();
      modal.remove();
    } else if (e.target === modal) {
      // Click on overlay background
      modal.remove();
    }
  });
  
  // Load balances
  walletManager.getBalance().then(balance => {
    const elem = document.getElementById('walletBalance');
    if (elem) elem.textContent = `${parseFloat(balance).toFixed(4)} ETH`;
  }).catch(err => {
    console.error('Failed to load balance:', err);
    const elem = document.getElementById('walletBalance');
    if (elem) elem.textContent = 'Error';
  });
  
  walletManager.getVaultBalance().then(balance => {
    const elem = document.getElementById('vaultBalance');
    if (elem) elem.textContent = `${parseFloat(balance).toFixed(4)} ETH`;
  }).catch(err => {
    console.error('Failed to load vault balance:', err);
    const elem = document.getElementById('vaultBalance');
    if (elem) elem.textContent = 'Error';
  });
}

function showDepositModal() {
  if (!walletManager.connected) {
    alert('Please connect your wallet first');
    return;
  }
  
  // Remove existing modals
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content deposit-modal">
      <div class="modal-header">
        <h3>Deposit to Vault</h3>
        <button class="modal-close" data-action="close">×</button>
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
        <button class="btn btn-primary btn-full" data-action="execute-deposit">
          Deposit
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add event listeners
  modal.addEventListener('click', async (e) => {
    const action = e.target.getAttribute('data-action');
    if (action === 'close') {
      modal.remove();
    } else if (action === 'execute-deposit') {
      await executeDeposit(e.target);
    } else if (e.target === modal) {
      modal.remove();
    }
  });
  
  // Load available balance
  walletManager.getBalance().then(balance => {
    const elem = document.getElementById('availableBalance');
    if (elem) elem.textContent = `${parseFloat(balance).toFixed(4)} ETH`;
  }).catch(err => {
    console.error('Failed to load balance:', err);
    const elem = document.getElementById('availableBalance');
    if (elem) elem.textContent = 'Error';
  });
}

async function executeDeposit(btn) {
  const amountInput = document.getElementById('depositAmount');
  const amount = parseFloat(amountInput.value);
  
  if (!amount || amount <= 0) {
    alert('Please enter a valid amount');
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Depositing...';
  
  try {
    const result = await walletManager.deposit(amount);
    
    if (result.success) {
      alert(`✅ Deposit successful!\n\nAmount: ${result.amount} ETH\nTx: ${result.txHash}`);
      const modal = document.querySelector('.modal-overlay');
      if (modal) modal.remove();
    } else {
      alert(`❌ Deposit failed: ${result.error}`);
      btn.disabled = false;
      btn.textContent = 'Deposit';
    }
  } catch (error) {
    console.error('Deposit error:', error);
    alert(`❌ Deposit failed: ${error.message}`);
    btn.disabled = false;
    btn.textContent = 'Deposit';
  }
}
