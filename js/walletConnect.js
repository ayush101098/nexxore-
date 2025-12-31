/**
 * Nexxore Wallet Connection Module
 * Supports MetaMask, WalletConnect, Coinbase Wallet, and more
 */

// Wallet state
const WalletState = {
  NOT_CONNECTED: 'not_connected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error'
};

// Global wallet state
let walletState = {
  status: WalletState.NOT_CONNECTED,
  address: null,
  chainId: null,
  provider: null,
  balance: null,
  error: null
};

// Supported wallets configuration
const SUPPORTED_WALLETS = [
  {
    id: 'metamask',
    name: 'MetaMask',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M21.3622 3L13.0497 9.16875L14.5122 5.4825L21.3622 3Z" fill="#E17726"/><path d="M2.64844 3L10.8847 9.225L9.49844 5.4825L2.64844 3Z" fill="#E27625"/><path d="M18.4497 16.8188L16.2559 20.2313L20.8934 21.5063L22.2184 16.8938L18.4497 16.8188Z" fill="#E27625"/><path d="M1.79688 16.8938L3.11438 21.5063L7.74438 20.2313L5.55813 16.8188L1.79688 16.8938Z" fill="#E27625"/><path d="M7.50375 10.6687L6.225 12.6L10.8225 12.8062L10.665 7.89374L7.50375 10.6687Z" fill="#E27625"/><path d="M16.5037 10.6688L13.2937 7.8375L13.1987 12.8063L17.7825 12.6L16.5037 10.6688Z" fill="#E27625"/><path d="M7.74438 20.2313L10.5469 18.8813L8.12438 16.9312L7.74438 20.2313Z" fill="#E27625"/><path d="M13.4609 18.8813L16.2559 20.2313L15.8834 16.9312L13.4609 18.8813Z" fill="#E27625"/></svg>`,
    checkInstalled: () => typeof window.ethereum !== 'undefined' && window.ethereum.isMetaMask,
    connect: connectMetaMask,
    installUrl: 'https://metamask.io/download/'
  },
  {
    id: 'walletconnect',
    name: 'WalletConnect',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M6.09 8.62C9.36 5.48 14.64 5.48 17.91 8.62L18.29 8.99C18.45 9.15 18.45 9.4 18.29 9.55L16.96 10.83C16.88 10.91 16.75 10.91 16.67 10.83L16.14 10.32C13.86 8.12 10.14 8.12 7.86 10.32L7.29 10.87C7.21 10.95 7.08 10.95 7 10.87L5.67 9.59C5.51 9.44 5.51 9.19 5.67 9.03L6.09 8.62ZM20.65 11.29L21.83 12.43C21.99 12.58 21.99 12.83 21.83 12.99L16.41 18.23C16.25 18.39 15.99 18.39 15.84 18.23L12.05 14.56C12.01 14.52 11.95 14.52 11.91 14.56L8.12 18.23C7.96 18.39 7.7 18.39 7.55 18.23L2.17 12.99C2.01 12.83 2.01 12.58 2.17 12.43L3.35 11.29C3.51 11.13 3.77 11.13 3.92 11.29L7.71 14.96C7.75 15 7.81 15 7.85 14.96L11.64 11.29C11.8 11.13 12.06 11.13 12.21 11.29L15.99 14.96C16.03 15 16.09 15 16.13 14.96L19.92 11.29C20.08 11.13 20.34 11.13 20.49 11.29L20.65 11.29Z" fill="#3B99FC"/></svg>`,
    checkInstalled: () => true, // Always available
    connect: connectWalletConnect
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#0052FF"/><path d="M12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6ZM10.5 10.5H13.5V13.5H10.5V10.5Z" fill="white"/></svg>`,
    checkInstalled: () => typeof window.ethereum !== 'undefined' && window.ethereum.isCoinbaseWallet,
    connect: connectCoinbase,
    installUrl: 'https://www.coinbase.com/wallet'
  }
];

// Storage keys
const STORAGE_KEYS = {
  CONNECTED_WALLET: 'nexxore_connected_wallet',
  WALLET_ADDRESS: 'nexxore_wallet_address'
};

// Initialize wallet module
function initWallet() {
  console.log('🔌 Initializing wallet module...');
  
  // Check for persisted connection
  const savedWallet = localStorage.getItem(STORAGE_KEYS.CONNECTED_WALLET);
  const savedAddress = localStorage.getItem(STORAGE_KEYS.WALLET_ADDRESS);
  
  if (savedWallet && savedAddress && window.ethereum) {
    // Try to restore connection
    restoreConnection(savedWallet, savedAddress);
  }
  
  // Setup event listeners
  setupWalletListeners();
  
  // Setup UI
  setupWalletUI();
}

// Restore previous connection
async function restoreConnection(walletId, address) {
  console.log('🔄 Restoring wallet connection...', walletId);
  
  try {
    if (window.ethereum) {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      
      if (accounts.length > 0 && accounts[0].toLowerCase() === address.toLowerCase()) {
        walletState.status = WalletState.CONNECTED;
        walletState.address = accounts[0];
        walletState.provider = new ethers.providers.Web3Provider(window.ethereum);
        
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        walletState.chainId = parseInt(chainId, 16);
        
        await updateBalance();
        updateWalletUI();
        
        console.log('✅ Wallet connection restored:', walletState.address);
      } else {
        clearStoredConnection();
      }
    }
  } catch (error) {
    console.error('Failed to restore connection:', error);
    clearStoredConnection();
  }
}

// Setup wallet event listeners
function setupWalletListeners() {
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);
    window.ethereum.on('disconnect', handleDisconnect);
  }
}

// Handle account changes
function handleAccountsChanged(accounts) {
  console.log('👤 Accounts changed:', accounts);
  
  if (accounts.length === 0) {
    disconnectWallet();
  } else if (accounts[0] !== walletState.address) {
    walletState.address = accounts[0];
    localStorage.setItem(STORAGE_KEYS.WALLET_ADDRESS, accounts[0]);
    updateBalance();
    updateWalletUI();
  }
}

// Handle chain changes
function handleChainChanged(chainId) {
  console.log('🔗 Chain changed:', chainId);
  walletState.chainId = parseInt(chainId, 16);
  updateWalletUI();
}

// Handle disconnect
function handleDisconnect() {
  console.log('🔌 Wallet disconnected');
  disconnectWallet();
}

// Setup wallet UI elements
function setupWalletUI() {
  // Create wallet modal if it doesn't exist
  if (!document.getElementById('walletModal')) {
    createWalletModal();
  }
  
  // Attach click handlers to all connect buttons
  document.querySelectorAll('#connectWalletBtn, .connect-wallet-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handleWalletButtonClick();
    });
  });
  
  // Initial UI update
  updateWalletUI();
}

// Create wallet selection modal
function createWalletModal() {
  const modal = document.createElement('div');
  modal.id = 'walletModal';
  modal.className = 'wallet-modal';
  modal.innerHTML = `
    <div class="wallet-modal-backdrop" onclick="closeWalletModal()"></div>
    <div class="wallet-modal-content">
      <div class="wallet-modal-header">
        <h3>Connect Wallet</h3>
        <button class="wallet-modal-close" onclick="closeWalletModal()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="wallet-modal-body">
        <p class="wallet-modal-subtitle">Choose your preferred wallet</p>
        <div class="wallet-options" id="walletOptions">
          ${SUPPORTED_WALLETS.map(wallet => `
            <button class="wallet-option" data-wallet="${wallet.id}" onclick="selectWallet('${wallet.id}')">
              <div class="wallet-option-icon">${wallet.icon}</div>
              <div class="wallet-option-info">
                <span class="wallet-option-name">${wallet.name}</span>
                <span class="wallet-option-status" id="status-${wallet.id}">
                  ${wallet.checkInstalled() ? 'Available' : 'Not Installed'}
                </span>
              </div>
              <svg class="wallet-option-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          `).join('')}
        </div>
        <div class="wallet-modal-footer">
          <p>By connecting, you agree to the Terms of Service</p>
        </div>
      </div>
      <div class="wallet-connecting" id="walletConnecting" style="display: none;">
        <div class="connecting-spinner"></div>
        <p>Connecting to <span id="connectingWalletName">wallet</span>...</p>
        <button class="btn-cancel" onclick="cancelConnection()">Cancel</button>
      </div>
      <div class="wallet-error" id="walletError" style="display: none;">
        <div class="error-icon">⚠️</div>
        <p id="errorMessage">Connection failed</p>
        <button class="btn-retry" onclick="retryConnection()">Try Again</button>
      </div>
    </div>
  `;
  
  // Add modal styles
  const styles = document.createElement('style');
  styles.textContent = `
    .wallet-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 10000;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    
    .wallet-modal.open {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .wallet-modal-backdrop {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
    }
    
    .wallet-modal-content {
      position: relative;
      background: linear-gradient(135deg, #1a1f3a 0%, #0a0e27 100%);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      width: 100%;
      max-width: 420px;
      max-height: 90vh;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      animation: modalSlideIn 0.3s ease;
    }
    
    @keyframes modalSlideIn {
      from {
        opacity: 0;
        transform: translateY(-20px) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
    
    .wallet-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 24px 24px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    .wallet-modal-header h3 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: #fff;
    }
    
    .wallet-modal-close {
      background: rgba(255, 255, 255, 0.05);
      border: none;
      border-radius: 10px;
      padding: 8px;
      cursor: pointer;
      color: #9ca3af;
      transition: all 0.2s;
    }
    
    .wallet-modal-close:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }
    
    .wallet-modal-body {
      padding: 20px 24px 24px;
    }
    
    .wallet-modal-subtitle {
      color: #9ca3af;
      font-size: 0.9rem;
      margin: 0 0 20px;
    }
    
    .wallet-options {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .wallet-option {
      display: flex;
      align-items: center;
      gap: 16px;
      width: 100%;
      padding: 16px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      cursor: pointer;
      transition: all 0.2s;
      text-align: left;
    }
    
    .wallet-option:hover {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(0, 212, 255, 0.3);
      transform: translateY(-2px);
    }
    
    .wallet-option:active {
      transform: translateY(0);
    }
    
    .wallet-option-icon {
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 12px;
    }
    
    .wallet-option-icon svg {
      width: 28px;
      height: 28px;
    }
    
    .wallet-option-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .wallet-option-name {
      font-size: 1rem;
      font-weight: 600;
      color: #fff;
    }
    
    .wallet-option-status {
      font-size: 0.8rem;
      color: #22c55e;
    }
    
    .wallet-option-status.not-installed {
      color: #9ca3af;
    }
    
    .wallet-option-arrow {
      color: #6b7280;
      transition: transform 0.2s;
    }
    
    .wallet-option:hover .wallet-option-arrow {
      transform: translateX(4px);
      color: #00d4ff;
    }
    
    .wallet-modal-footer {
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }
    
    .wallet-modal-footer p {
      color: #6b7280;
      font-size: 0.75rem;
      text-align: center;
      margin: 0;
    }
    
    .wallet-connecting,
    .wallet-error {
      padding: 48px 24px;
      text-align: center;
    }
    
    .connecting-spinner {
      width: 48px;
      height: 48px;
      border: 3px solid rgba(0, 212, 255, 0.2);
      border-top-color: #00d4ff;
      border-radius: 50%;
      margin: 0 auto 20px;
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .wallet-connecting p,
    .wallet-error p {
      color: #9ca3af;
      margin: 0 0 20px;
    }
    
    .error-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    
    .btn-cancel,
    .btn-retry {
      padding: 12px 24px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 10px;
      background: transparent;
      color: #fff;
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .btn-cancel:hover,
    .btn-retry:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    
    /* Connected dropdown */
    .wallet-connected-dropdown {
      position: relative;
    }
    
    .wallet-connected-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      background: linear-gradient(135deg, #22c55e, #16a34a);
      border: none;
      border-radius: 10px;
      color: white;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
    }
    
    .wallet-connected-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(34, 197, 94, 0.3);
    }
    
    .wallet-address-display {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .wallet-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .wallet-dropdown-menu {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      background: linear-gradient(135deg, #1a1f3a 0%, #0a0e27 100%);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      min-width: 220px;
      padding: 8px;
      display: none;
      z-index: 1000;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
    }
    
    .wallet-dropdown-menu.open {
      display: block;
      animation: dropdownSlide 0.2s ease;
    }
    
    @keyframes dropdownSlide {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .dropdown-item {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 12px 16px;
      background: transparent;
      border: none;
      border-radius: 8px;
      color: #e5e7eb;
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.2s;
      text-align: left;
    }
    
    .dropdown-item:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    
    .dropdown-item.disconnect {
      color: #ef4444;
    }
    
    .dropdown-item.disconnect:hover {
      background: rgba(239, 68, 68, 0.1);
    }
    
    .dropdown-divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.08);
      margin: 8px 0;
    }
    
    .balance-display {
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 8px;
      margin-bottom: 8px;
    }
    
    .balance-label {
      font-size: 0.75rem;
      color: #9ca3af;
      margin-bottom: 4px;
    }
    
    .balance-value {
      font-size: 1.1rem;
      font-weight: 600;
      color: #fff;
    }
  `;
  
  document.head.appendChild(styles);
  document.body.appendChild(modal);
}

// Handle wallet button click
function handleWalletButtonClick() {
  if (walletState.status === WalletState.CONNECTED) {
    toggleWalletDropdown();
  } else {
    openWalletModal();
  }
}

// Open wallet modal
function openWalletModal() {
  const modal = document.getElementById('walletModal');
  if (modal) {
    modal.classList.add('open');
    // Reset to wallet selection view
    document.querySelector('.wallet-modal-body').style.display = 'block';
    document.getElementById('walletConnecting').style.display = 'none';
    document.getElementById('walletError').style.display = 'none';
  }
}

// Close wallet modal
function closeWalletModal() {
  const modal = document.getElementById('walletModal');
  if (modal) {
    modal.classList.remove('open');
  }
}

// Select wallet
async function selectWallet(walletId) {
  const wallet = SUPPORTED_WALLETS.find(w => w.id === walletId);
  if (!wallet) return;
  
  console.log('🔌 Selecting wallet:', wallet.name);
  
  // Check if wallet is installed (for browser wallets)
  if (!wallet.checkInstalled() && wallet.installUrl) {
    if (confirm(`${wallet.name} is not installed. Would you like to install it?`)) {
      window.open(wallet.installUrl, '_blank');
    }
    return;
  }
  
  // Show connecting state
  showConnectingState(wallet.name);
  walletState.status = WalletState.CONNECTING;
  
  try {
    await wallet.connect();
    closeWalletModal();
  } catch (error) {
    console.error('Connection error:', error);
    showErrorState(error.message);
  }
}

// Show connecting state
function showConnectingState(walletName) {
  document.querySelector('.wallet-modal-body').style.display = 'none';
  document.getElementById('walletConnecting').style.display = 'block';
  document.getElementById('walletError').style.display = 'none';
  document.getElementById('connectingWalletName').textContent = walletName;
}

// Show error state
function showErrorState(message) {
  document.querySelector('.wallet-modal-body').style.display = 'none';
  document.getElementById('walletConnecting').style.display = 'none';
  document.getElementById('walletError').style.display = 'block';
  document.getElementById('errorMessage').textContent = message;
  walletState.status = WalletState.ERROR;
  walletState.error = message;
}

// Cancel connection
function cancelConnection() {
  walletState.status = WalletState.NOT_CONNECTED;
  document.querySelector('.wallet-modal-body').style.display = 'block';
  document.getElementById('walletConnecting').style.display = 'none';
}

// Retry connection
function retryConnection() {
  document.querySelector('.wallet-modal-body').style.display = 'block';
  document.getElementById('walletError').style.display = 'none';
  walletState.status = WalletState.NOT_CONNECTED;
  walletState.error = null;
}

// Connect MetaMask
async function connectMetaMask() {
  if (!window.ethereum || !window.ethereum.isMetaMask) {
    throw new Error('MetaMask is not installed');
  }
  
  try {
    const accounts = await window.ethereum.request({ 
      method: 'eth_requestAccounts' 
    });
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found');
    }
    
    walletState.address = accounts[0];
    walletState.provider = new ethers.providers.Web3Provider(window.ethereum);
    
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    walletState.chainId = parseInt(chainId, 16);
    
    await updateBalance();
    
    walletState.status = WalletState.CONNECTED;
    
    // Persist connection
    localStorage.setItem(STORAGE_KEYS.CONNECTED_WALLET, 'metamask');
    localStorage.setItem(STORAGE_KEYS.WALLET_ADDRESS, accounts[0]);
    
    updateWalletUI();
    
    console.log('✅ Connected to MetaMask:', walletState.address);
  } catch (error) {
    walletState.status = WalletState.ERROR;
    
    if (error.code === 4001) {
      throw new Error('Connection rejected. Please approve the connection in MetaMask.');
    } else if (error.code === -32002) {
      throw new Error('Connection request pending. Please check MetaMask.');
    }
    
    throw error;
  }
}

// Connect WalletConnect (simplified for demo - would use @walletconnect/web3-provider in production)
async function connectWalletConnect() {
  // For now, fallback to MetaMask if available, show message otherwise
  if (window.ethereum) {
    return connectMetaMask();
  }
  throw new Error('WalletConnect requires additional setup. Please use MetaMask or install a Web3 wallet.');
}

// Connect Coinbase Wallet
async function connectCoinbase() {
  if (!window.ethereum || !window.ethereum.isCoinbaseWallet) {
    if (window.ethereum) {
      // Try connecting anyway - might be in Coinbase Wallet browser
      return connectMetaMask();
    }
    throw new Error('Coinbase Wallet is not installed');
  }
  
  return connectMetaMask(); // Same flow for browser extension
}

// Update balance
async function updateBalance() {
  if (!walletState.provider || !walletState.address) return;
  
  try {
    const balance = await walletState.provider.getBalance(walletState.address);
    walletState.balance = ethers.utils.formatEther(balance);
  } catch (error) {
    console.error('Failed to fetch balance:', error);
    walletState.balance = null;
  }
}

// Disconnect wallet
function disconnectWallet() {
  console.log('🔌 Disconnecting wallet...');
  
  walletState = {
    status: WalletState.NOT_CONNECTED,
    address: null,
    chainId: null,
    provider: null,
    balance: null,
    error: null
  };
  
  clearStoredConnection();
  updateWalletUI();
  closeWalletDropdown();
}

// Clear stored connection
function clearStoredConnection() {
  localStorage.removeItem(STORAGE_KEYS.CONNECTED_WALLET);
  localStorage.removeItem(STORAGE_KEYS.WALLET_ADDRESS);
}

// Update wallet UI
function updateWalletUI() {
  const buttons = document.querySelectorAll('#connectWalletBtn, .connect-wallet-btn');
  
  buttons.forEach(btn => {
    if (walletState.status === WalletState.CONNECTED && walletState.address) {
      const shortAddress = `${walletState.address.slice(0, 6)}...${walletState.address.slice(-4)}`;
      
      // Replace button with connected dropdown
      btn.outerHTML = `
        <div class="wallet-connected-dropdown" id="walletDropdown">
          <button class="wallet-connected-btn" onclick="toggleWalletDropdown()">
            <div class="wallet-icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10"/>
              </svg>
            </div>
            <span>${shortAddress}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          <div class="wallet-dropdown-menu" id="walletDropdownMenu">
            <div class="balance-display">
              <div class="balance-label">Balance</div>
              <div class="balance-value">${walletState.balance ? parseFloat(walletState.balance).toFixed(4) : '0.0000'} ETH</div>
            </div>
            <button class="dropdown-item" onclick="copyAddress()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
              Copy Address
            </button>
            <button class="dropdown-item" onclick="viewOnExplorer()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              View on Explorer
            </button>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item disconnect" onclick="disconnectWallet()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Disconnect
            </button>
          </div>
        </div>
      `;
    } else if (walletState.status === WalletState.CONNECTING) {
      btn.innerHTML = `
        <span class="connecting-dots">Connecting</span>
      `;
      btn.disabled = true;
    } else {
      // Ensure button is reset to default state
      if (btn.tagName === 'DIV') {
        btn.outerHTML = `<button id="connectWalletBtn" class="btn btn-primary" style="padding: 10px 20px; border: none; border-radius: 8px; background: linear-gradient(135deg, #00d4ff, #0099ff); color: white; font-weight: 600; cursor: pointer; transition: all 0.3s;">Connect Wallet</button>`;
        // Re-attach event listener
        setTimeout(() => {
          const newBtn = document.getElementById('connectWalletBtn');
          if (newBtn) {
            newBtn.addEventListener('click', (e) => {
              e.preventDefault();
              handleWalletButtonClick();
            });
          }
        }, 0);
      } else {
        btn.textContent = 'Connect Wallet';
        btn.disabled = false;
        btn.classList.remove('connected');
      }
    }
  });
  
  // Dispatch custom event for other components
  window.dispatchEvent(new CustomEvent('walletStateChanged', { detail: walletState }));
}

// Toggle wallet dropdown
function toggleWalletDropdown() {
  const menu = document.getElementById('walletDropdownMenu');
  if (menu) {
    menu.classList.toggle('open');
  }
}

// Close wallet dropdown
function closeWalletDropdown() {
  const menu = document.getElementById('walletDropdownMenu');
  if (menu) {
    menu.classList.remove('open');
  }
}

// Copy address to clipboard
function copyAddress() {
  if (walletState.address) {
    navigator.clipboard.writeText(walletState.address).then(() => {
      alert('Address copied to clipboard!');
    });
  }
  closeWalletDropdown();
}

// View on block explorer
function viewOnExplorer() {
  if (walletState.address) {
    const explorerUrl = walletState.chainId === 1 
      ? `https://etherscan.io/address/${walletState.address}`
      : `https://sepolia.etherscan.io/address/${walletState.address}`;
    window.open(explorerUrl, '_blank');
  }
  closeWalletDropdown();
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('walletDropdown');
  if (dropdown && !dropdown.contains(e.target)) {
    closeWalletDropdown();
  }
});

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWallet);
} else {
  initWallet();
}

// Export for external use
window.WalletConnect = {
  init: initWallet,
  connect: openWalletModal,
  disconnect: disconnectWallet,
  getState: () => walletState,
  getAddress: () => walletState.address,
  getProvider: () => walletState.provider,
  isConnected: () => walletState.status === WalletState.CONNECTED
};
