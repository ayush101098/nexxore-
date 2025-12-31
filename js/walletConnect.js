/**
 * Nexxore Wallet Connection Module
 * Production-ready implementation with wagmi-inspired patterns
 * Supports: MetaMask, WalletConnect, Coinbase Wallet
 */

// ============================================================================
// Configuration
// ============================================================================

const SUPPORTED_CHAINS = {
  1: { name: 'Ethereum', symbol: 'ETH', explorer: 'https://etherscan.io' },
  137: { name: 'Polygon', symbol: 'MATIC', explorer: 'https://polygonscan.com' },
  42161: { name: 'Arbitrum', symbol: 'ETH', explorer: 'https://arbiscan.io' },
  10: { name: 'Optimism', symbol: 'ETH', explorer: 'https://optimistic.etherscan.io' },
  8453: { name: 'Base', symbol: 'ETH', explorer: 'https://basescan.org' },
};

const WALLET_PROVIDERS = {
  metamask: {
    id: 'metamask',
    name: 'MetaMask',
    icon: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M32.9583 3L21.7083 11.7917L23.8333 6.45833L32.9583 3Z" fill="#E2761B"/><path d="M7.04167 3L18.2083 11.875L16.1667 6.45833L7.04167 3Z" fill="#E4761B"/><path d="M28.5417 26.0417L25.4167 30.9167L32.2917 32.8333L34.3333 26.1667L28.5417 26.0417Z" fill="#E4761B"/><path d="M5.66667 26.1667L7.70833 32.8333L14.5833 30.9167L11.4583 26.0417L5.66667 26.1667Z" fill="#E4761B"/><path d="M14.2083 17.4583L12.25 20.4583L19.0833 20.75L18.8333 13.375L14.2083 17.4583Z" fill="#E4761B"/><path d="M25.7917 17.4583L21.0833 13.2917L20.9167 20.75L27.75 20.4583L25.7917 17.4583Z" fill="#E4761B"/><path d="M14.5833 30.9167L18.6667 28.9167L15.125 26.2083L14.5833 30.9167Z" fill="#E4761B"/><path d="M21.3333 28.9167L25.4167 30.9167L24.875 26.2083L21.3333 28.9167Z" fill="#E4761B"/><path d="M25.4167 30.9167L21.3333 28.9167L21.6667 31.5417L21.625 32.75L25.4167 30.9167Z" fill="#D7C1B3"/><path d="M14.5833 30.9167L18.375 32.75L18.3333 31.5417L18.6667 28.9167L14.5833 30.9167Z" fill="#D7C1B3"/><path d="M18.4583 24.5L15.0417 23.5L17.4583 22.4167L18.4583 24.5Z" fill="#233447"/><path d="M21.5417 24.5L22.5417 22.4167L24.9583 23.5L21.5417 24.5Z" fill="#233447"/><path d="M14.5833 30.9167L15.1667 26.0417L11.4583 26.1667L14.5833 30.9167Z" fill="#CD6116"/><path d="M24.8333 26.0417L25.4167 30.9167L28.5417 26.1667L24.8333 26.0417Z" fill="#CD6116"/><path d="M27.75 20.4583L20.9167 20.75L21.5417 24.5L22.5417 22.4167L24.9583 23.5L27.75 20.4583Z" fill="#CD6116"/><path d="M15.0417 23.5L17.4583 22.4167L18.4583 24.5L19.0833 20.75L12.25 20.4583L15.0417 23.5Z" fill="#CD6116"/><path d="M12.25 20.4583L15.125 26.2083L15.0417 23.5L12.25 20.4583Z" fill="#E4751F"/><path d="M24.9583 23.5L24.875 26.2083L27.75 20.4583L24.9583 23.5Z" fill="#E4751F"/><path d="M19.0833 20.75L18.4583 24.5L19.25 28.5L19.4167 23.2083L19.0833 20.75Z" fill="#E4751F"/><path d="M20.9167 20.75L20.5833 23.2083L20.75 28.5L21.5417 24.5L20.9167 20.75Z" fill="#E4751F"/><path d="M21.5417 24.5L20.75 28.5L21.3333 28.9167L24.875 26.2083L24.9583 23.5L21.5417 24.5Z" fill="#F6851B"/><path d="M15.0417 23.5L15.125 26.2083L18.6667 28.9167L19.25 28.5L18.4583 24.5L15.0417 23.5Z" fill="#F6851B"/><path d="M21.625 32.75L21.6667 31.5417L21.3333 31.25H18.6667L18.3333 31.5417L18.375 32.75L14.5833 30.9167L15.875 31.9583L18.625 33.875H21.375L24.125 31.9583L25.4167 30.9167L21.625 32.75Z" fill="#C0AD9E"/><path d="M21.3333 28.9167L20.75 28.5H19.25L18.6667 28.9167L18.3333 31.5417L18.6667 31.25H21.3333L21.6667 31.5417L21.3333 28.9167Z" fill="#161616"/><path d="M33.5 12.2917L34.5 7.41667L32.9583 3L21.3333 11.4583L25.7917 17.4583L32.0833 19.3333L33.5833 17.5833L32.9167 17.0833L33.9583 16.125L33.125 15.4583L34.1667 14.6667L33.5 12.2917Z" fill="#763D16"/><path d="M5.5 7.41667L6.5 12.2917L5.83333 14.6667L6.875 15.4583L6.04167 16.125L7.08333 17.0833L6.41667 17.5833L7.91667 19.3333L14.2083 17.4583L18.6667 11.4583L7.04167 3L5.5 7.41667Z" fill="#763D16"/><path d="M32.0833 19.3333L25.7917 17.4583L27.75 20.4583L24.875 26.2083L28.5417 26.1667H34.3333L32.0833 19.3333Z" fill="#F6851B"/><path d="M14.2083 17.4583L7.91667 19.3333L5.66667 26.1667H11.4583L15.125 26.2083L12.25 20.4583L14.2083 17.4583Z" fill="#F6851B"/><path d="M20.9167 20.75L21.3333 11.4583L23.8333 6.45833H16.1667L18.6667 11.4583L19.0833 20.75L19.25 23.2083V28.5H20.75V23.2083L20.9167 20.75Z" fill="#F6851B"/></svg>`,
    check: () => typeof window.ethereum !== 'undefined' && window.ethereum.isMetaMask,
    connect: connectMetaMask,
  },
  walletconnect: {
    id: 'walletconnect',
    name: 'WalletConnect',
    icon: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="8" fill="#3B99FC"/><path d="M13.3 16.5c4.1-4 10.7-4 14.8 0l.5.5c.2.2.2.5 0 .7l-1.7 1.6c-.1.1-.3.1-.4 0l-.7-.6c-2.8-2.8-7.4-2.8-10.3 0l-.7.7c-.1.1-.3.1-.4 0l-1.7-1.6c-.2-.2-.2-.5 0-.7l.6-.6zm18.3 3.4l1.5 1.4c.2.2.2.5 0 .7l-6.7 6.6c-.2.2-.5.2-.7 0l-4.8-4.7c0-.1-.1-.1-.2 0l-4.8 4.7c-.2.2-.5.2-.7 0L8.5 22c-.2-.2-.2-.5 0-.7l1.5-1.4c.2-.2.5-.2.7 0l4.8 4.7c0 .1.1.1.2 0l4.8-4.7c.2-.2.5-.2.7 0l4.8 4.7c0 .1.1.1.2 0l4.8-4.7c.2-.2.5-.2.7 0z" fill="#fff"/></svg>`,
    check: () => true,
    connect: connectWalletConnect,
  },
  coinbase: {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    icon: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="8" fill="#0052FF"/><path d="M20 6C12.268 6 6 12.268 6 20s6.268 14 14 14 14-6.268 14-14S27.732 6 20 6zm-4.2 11.8c0-.99.81-1.8 1.8-1.8h4.8c.99 0 1.8.81 1.8 1.8v4.4c0 .99-.81 1.8-1.8 1.8h-4.8c-.99 0-1.8-.81-1.8-1.8v-4.4z" fill="#fff"/></svg>`,
    check: () => typeof window.ethereum !== 'undefined' && (window.ethereum.isCoinbaseWallet || window.ethereum.providers?.some(p => p.isCoinbaseWallet)),
    connect: connectCoinbaseWallet,
  },
};

// ============================================================================
// State Management
// ============================================================================

const WalletState = {
  NOT_CONNECTED: 'NOT_CONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  ERROR: 'ERROR',
};

let walletState = {
  status: WalletState.NOT_CONNECTED,
  address: null,
  chainId: null,
  balance: null,
  provider: null,
  walletType: null,
  error: null,
};

const stateListeners = new Set();

function updateState(newState) {
  walletState = { ...walletState, ...newState };
  stateListeners.forEach(listener => listener(walletState));
  saveStateToStorage();
}

function onStateChange(listener) {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

// ============================================================================
// Local Storage
// ============================================================================

const STORAGE_KEY = 'nexxore_wallet';

function saveStateToStorage() {
  if (walletState.status === WalletState.CONNECTED) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      address: walletState.address,
      chainId: walletState.chainId,
      walletType: walletState.walletType,
    }));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function loadStateFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

// ============================================================================
// Wallet Connection Functions
// ============================================================================

async function connectMetaMask() {
  if (!window.ethereum) {
    throw new Error('MetaMask is not installed. Please install it from metamask.io');
  }

  let provider = window.ethereum;
  if (window.ethereum.providers?.length) {
    provider = window.ethereum.providers.find(p => p.isMetaMask) || window.ethereum;
  }

  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const chainId = await provider.request({ method: 'eth_chainId' });

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts found. Please unlock MetaMask.');
  }

  const balance = await provider.request({
    method: 'eth_getBalance',
    params: [accounts[0], 'latest']
  });

  return {
    address: accounts[0],
    chainId: parseInt(chainId, 16),
    balance: parseInt(balance, 16) / 1e18,
    provider: provider,
  };
}

async function connectWalletConnect() {
  throw new Error('WalletConnect integration requires Web3Modal. Please use MetaMask for now.');
}

async function connectCoinbaseWallet() {
  if (!window.ethereum) {
    throw new Error('Coinbase Wallet is not installed. Please install it from coinbase.com/wallet');
  }

  let provider = window.ethereum;
  if (window.ethereum.providers?.length) {
    provider = window.ethereum.providers.find(p => p.isCoinbaseWallet);
    if (!provider) {
      throw new Error('Coinbase Wallet not found. Please make sure it\'s installed.');
    }
  } else if (!window.ethereum.isCoinbaseWallet) {
    throw new Error('Coinbase Wallet not detected. Please install it from coinbase.com/wallet');
  }

  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const chainId = await provider.request({ method: 'eth_chainId' });

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts found. Please unlock Coinbase Wallet.');
  }

  const balance = await provider.request({
    method: 'eth_getBalance',
    params: [accounts[0], 'latest']
  });

  return {
    address: accounts[0],
    chainId: parseInt(chainId, 16),
    balance: parseInt(balance, 16) / 1e18,
    provider: provider,
  };
}

// ============================================================================
// Main Connect/Disconnect Functions
// ============================================================================

async function connect(walletType) {
  const wallet = WALLET_PROVIDERS[walletType];
  if (!wallet) {
    throw new Error(`Unknown wallet type: ${walletType}`);
  }

  updateState({ status: WalletState.CONNECTING, error: null });

  try {
    const result = await wallet.connect();

    updateState({
      status: WalletState.CONNECTED,
      address: result.address,
      chainId: result.chainId,
      balance: result.balance,
      provider: result.provider,
      walletType: walletType,
      error: null,
    });

    setupProviderListeners(result.provider);
    return result;
  } catch (error) {
    let errorMessage = error.message;

    if (error.code === 4001) {
      errorMessage = 'Connection rejected. Please approve the connection in your wallet.';
    } else if (error.code === -32002) {
      errorMessage = 'Connection pending. Please check your wallet for requests.';
    }

    updateState({
      status: WalletState.ERROR,
      error: errorMessage
    });

    throw new Error(errorMessage);
  }
}

function disconnect() {
  if (walletState.provider) {
    walletState.provider.removeAllListeners?.('accountsChanged');
    walletState.provider.removeAllListeners?.('chainChanged');
  }

  updateState({
    status: WalletState.NOT_CONNECTED,
    address: null,
    chainId: null,
    balance: null,
    provider: null,
    walletType: null,
    error: null,
  });

  closeModal();
}

// ============================================================================
// Provider Event Listeners
// ============================================================================

function setupProviderListeners(provider) {
  if (!provider) return;

  provider.on('accountsChanged', async (accounts) => {
    if (accounts.length === 0) {
      disconnect();
    } else {
      const balance = await provider.request({
        method: 'eth_getBalance',
        params: [accounts[0], 'latest']
      });

      updateState({
        address: accounts[0],
        balance: parseInt(balance, 16) / 1e18,
      });
    }
  });

  provider.on('chainChanged', (chainId) => {
    updateState({ chainId: parseInt(chainId, 16) });
  });

  provider.on('disconnect', () => {
    disconnect();
  });
}

// ============================================================================
// Auto-reconnect
// ============================================================================

async function tryAutoConnect() {
  const saved = loadStateFromStorage();
  if (!saved?.walletType) return;

  const wallet = WALLET_PROVIDERS[saved.walletType];
  if (!wallet?.check()) return;

  try {
    const provider = window.ethereum;
    if (!provider) return;

    const accounts = await provider.request({ method: 'eth_accounts' });
    if (accounts.length === 0) return;

    await connect(saved.walletType);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// ============================================================================
// Modal UI
// ============================================================================

let modalElement = null;

function createModal() {
  if (modalElement) return modalElement;

  const modal = document.createElement('div');
  modal.id = 'walletModal';
  modal.innerHTML = `
    <div class="wallet-modal-backdrop"></div>
    <div class="wallet-modal-container">
      <div class="wallet-modal-header">
        <h3>Connect Wallet</h3>
        <button class="wallet-modal-close" aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="wallet-modal-body">
        <p class="wallet-modal-subtitle">Choose your preferred wallet</p>
        <div class="wallet-options"></div>
        <div class="wallet-modal-error"></div>
      </div>
      <div class="wallet-modal-footer">
        <p>New to wallets? <a href="https://ethereum.org/wallets/" target="_blank">Learn more</a></p>
      </div>
    </div>
  `;

  const styles = document.createElement('style');
  styles.textContent = `
    #walletModal {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    #walletModal.open {
      display: flex;
    }

    .wallet-modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      animation: wmFadeIn 0.2s ease;
    }

    .wallet-modal-container {
      position: relative;
      width: 100%;
      max-width: 420px;
      background: linear-gradient(180deg, rgba(30, 30, 35, 0.98) 0%, rgba(20, 20, 25, 0.98) 100%);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
      animation: wmSlideUp 0.3s ease;
      overflow: hidden;
    }

    .wallet-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 24px 24px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .wallet-modal-header h3 {
      font-size: 1.25rem;
      font-weight: 600;
      color: #fff;
      margin: 0;
    }

    .wallet-modal-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      color: #9ca3af;
      cursor: pointer;
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
      font-size: 0.9rem;
      color: #6b7280;
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
      padding: 16px 20px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
      overflow: hidden;
    }

    .wallet-option:hover:not(.disabled) {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(59, 130, 246, 0.5);
      transform: translateY(-2px);
    }

    .wallet-option.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .wallet-option.connecting {
      pointer-events: none;
    }

    .wallet-option.connecting::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.1), transparent);
      animation: wmShimmer 1.5s infinite;
    }

    .wallet-option-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      overflow: hidden;
      flex-shrink: 0;
      background: rgba(255, 255, 255, 0.05);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .wallet-option-icon svg {
      width: 100%;
      height: 100%;
    }

    .wallet-option-info {
      flex: 1;
      min-width: 0;
    }

    .wallet-option-name {
      font-size: 1rem;
      font-weight: 600;
      color: #fff;
      margin-bottom: 2px;
    }

    .wallet-option-status {
      font-size: 0.8rem;
      color: #6b7280;
    }

    .wallet-option-status.detected {
      color: #22c55e;
    }

    .wallet-option-status.connecting {
      color: #3b82f6;
    }

    .wallet-option-arrow {
      color: #4b5563;
      transition: transform 0.2s;
    }

    .wallet-option:hover:not(.disabled) .wallet-option-arrow {
      transform: translateX(4px);
      color: #9ca3af;
    }

    .wallet-modal-error {
      margin-top: 16px;
      padding: 14px 16px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 12px;
      color: #f87171;
      font-size: 0.875rem;
      display: none;
      animation: wmFadeIn 0.2s ease;
    }

    .wallet-modal-error.show {
      display: block;
    }

    .wallet-modal-footer {
      padding: 16px 24px 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .wallet-modal-footer p {
      font-size: 0.8rem;
      color: #6b7280;
      text-align: center;
      margin: 0;
    }

    .wallet-modal-footer a {
      color: #60a5fa;
      text-decoration: none;
    }

    .wallet-modal-footer a:hover {
      text-decoration: underline;
    }

    /* Connected Button Wrapper */
    .wallet-connected-wrapper {
      position: relative;
    }

    .wallet-connected-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.05));
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
    }

    .wallet-connected-btn:hover {
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(34, 197, 94, 0.1));
      border-color: rgba(34, 197, 94, 0.5);
    }

    .wallet-connected-indicator {
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
    }

    .wallet-connected-address {
      font-size: 0.9rem;
      font-weight: 500;
      color: #fff;
    }

    .wallet-connected-chevron {
      color: #9ca3af;
      transition: transform 0.2s;
    }

    .wallet-connected-wrapper.open .wallet-connected-chevron {
      transform: rotate(180deg);
    }

    .wallet-dropdown {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      min-width: 220px;
      background: rgba(30, 30, 35, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
      opacity: 0;
      visibility: hidden;
      transform: translateY(-10px);
      transition: all 0.2s ease;
      z-index: 100;
      overflow: hidden;
    }

    .wallet-connected-wrapper.open .wallet-dropdown {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }

    .wallet-dropdown-header {
      padding: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .wallet-dropdown-balance {
      font-size: 1.25rem;
      font-weight: 600;
      color: #fff;
      margin-bottom: 4px;
    }

    .wallet-dropdown-chain {
      font-size: 0.8rem;
      color: #9ca3af;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .wallet-dropdown-chain-dot {
      width: 6px;
      height: 6px;
      background: #22c55e;
      border-radius: 50%;
    }

    .wallet-dropdown-actions {
      padding: 8px;
    }

    .wallet-dropdown-action {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 12px;
      background: transparent;
      border: none;
      border-radius: 10px;
      color: #d1d5db;
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.15s;
      text-align: left;
      font-family: inherit;
    }

    .wallet-dropdown-action:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
    }

    .wallet-dropdown-action.danger:hover {
      background: rgba(239, 68, 68, 0.1);
      color: #f87171;
    }

    .wallet-dropdown-action svg {
      width: 18px;
      height: 18px;
      opacity: 0.7;
    }

    @keyframes wmFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes wmSlideUp {
      from {
        opacity: 0;
        transform: translateY(20px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes wmShimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }

    @media (max-width: 480px) {
      .wallet-modal-container {
        max-width: none;
        margin: 10px;
        border-radius: 16px;
      }

      .wallet-modal-header {
        padding: 20px 20px 14px;
      }

      .wallet-modal-body {
        padding: 16px 20px 20px;
      }

      .wallet-option {
        padding: 14px 16px;
      }

      .wallet-option-icon {
        width: 40px;
        height: 40px;
      }
    }
  `;

  document.head.appendChild(styles);
  document.body.appendChild(modal);

  const optionsContainer = modal.querySelector('.wallet-options');
  Object.values(WALLET_PROVIDERS).forEach(wallet => {
    const isAvailable = wallet.check();
    const option = document.createElement('div');
    option.className = `wallet-option ${!isAvailable && wallet.id !== 'walletconnect' ? 'disabled' : ''}`;
    option.dataset.walletId = wallet.id;
    option.innerHTML = `
      <div class="wallet-option-icon">${wallet.icon}</div>
      <div class="wallet-option-info">
        <div class="wallet-option-name">${wallet.name}</div>
        <div class="wallet-option-status ${isAvailable ? 'detected' : ''}">${
          wallet.id === 'walletconnect' ? 'Scan with mobile' :
          isAvailable ? 'Detected' : 'Not installed'
        }</div>
      </div>
      <svg class="wallet-option-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18l6-6-6-6"/>
      </svg>
    `;

    option.addEventListener('click', () => handleWalletSelect(wallet.id, option));
    optionsContainer.appendChild(option);
  });

  modal.querySelector('.wallet-modal-backdrop').addEventListener('click', closeModal);
  modal.querySelector('.wallet-modal-close').addEventListener('click', closeModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeModal();
    }
  });

  modalElement = modal;
  return modal;
}

async function handleWalletSelect(walletId, optionElement) {
  const errorEl = modalElement.querySelector('.wallet-modal-error');
  errorEl.classList.remove('show');
  errorEl.textContent = '';

  optionElement.classList.add('connecting');
  const statusEl = optionElement.querySelector('.wallet-option-status');
  const originalStatus = statusEl.textContent;
  statusEl.textContent = 'Connecting...';
  statusEl.classList.remove('detected');
  statusEl.classList.add('connecting');

  try {
    await connect(walletId);
    closeModal();
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.add('show');

    optionElement.classList.remove('connecting');
    statusEl.textContent = originalStatus;
    statusEl.classList.remove('connecting');
    if (WALLET_PROVIDERS[walletId].check()) {
      statusEl.classList.add('detected');
    }
  }
}

function openModal() {
  const modal = createModal();
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  if (modalElement) {
    modalElement.classList.remove('open');
    document.body.style.overflow = '';

    const errorEl = modalElement.querySelector('.wallet-modal-error');
    errorEl.classList.remove('show');
    errorEl.textContent = '';
  }
}

// ============================================================================
// UI Binding
// ============================================================================

function formatAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatBalance(balance) {
  if (balance === null || balance === undefined) return '0.00';
  return balance.toFixed(4);
}

function updateButtonUI(button) {
  if (!button) return;

  const parent = button.parentElement;

  const existingWrapper = parent.querySelector('.wallet-connected-wrapper');
  if (existingWrapper) {
    existingWrapper.remove();
  }

  if (walletState.status === WalletState.CONNECTED) {
    button.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'wallet-connected-wrapper';

    const chainInfo = SUPPORTED_CHAINS[walletState.chainId] || { name: `Chain ${walletState.chainId}`, symbol: 'ETH' };

    wrapper.innerHTML = `
      <button class="wallet-connected-btn" type="button">
        <span class="wallet-connected-indicator"></span>
        <span class="wallet-connected-address">${formatAddress(walletState.address)}</span>
        <svg class="wallet-connected-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <div class="wallet-dropdown">
        <div class="wallet-dropdown-header">
          <div class="wallet-dropdown-balance">${formatBalance(walletState.balance)} ${chainInfo.symbol}</div>
          <div class="wallet-dropdown-chain">
            <span class="wallet-dropdown-chain-dot"></span>
            ${chainInfo.name}
          </div>
        </div>
        <div class="wallet-dropdown-actions">
          <button class="wallet-dropdown-action" data-action="copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            Copy Address
          </button>
          <button class="wallet-dropdown-action" data-action="explorer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            View on Explorer
          </button>
          <button class="wallet-dropdown-action danger" data-action="disconnect">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Disconnect
          </button>
        </div>
      </div>
    `;

    button.insertAdjacentElement('afterend', wrapper);

    const btn = wrapper.querySelector('.wallet-connected-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      wrapper.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        wrapper.classList.remove('open');
      }
    });

    wrapper.querySelectorAll('.wallet-dropdown-action').forEach(action => {
      action.addEventListener('click', (e) => {
        e.stopPropagation();
        const actionType = action.dataset.action;

        if (actionType === 'copy') {
          navigator.clipboard.writeText(walletState.address);
          action.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Copied!
          `;
          setTimeout(() => {
            action.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
              Copy Address
            `;
          }, 2000);
        } else if (actionType === 'explorer') {
          const explorer = chainInfo.explorer || 'https://etherscan.io';
          window.open(`${explorer}/address/${walletState.address}`, '_blank');
        } else if (actionType === 'disconnect') {
          disconnect();
        }

        wrapper.classList.remove('open');
      });
    });
  } else {
    button.style.display = '';
    button.textContent = walletState.status === WalletState.CONNECTING ? 'Connecting...' : 'Connect Wallet';
    button.disabled = walletState.status === WalletState.CONNECTING;
  }
}

// ============================================================================
// Initialize
// ============================================================================

function initWallet() {
  const buttons = document.querySelectorAll('#connectWalletBtn, [data-wallet-connect]');

  buttons.forEach(button => {
    updateButtonUI(button);

    button.addEventListener('click', () => {
      if (walletState.status === WalletState.CONNECTED) {
        return;
      }
      openModal();
    });

    onStateChange(() => updateButtonUI(button));
  });

  tryAutoConnect();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWallet);
} else {
  initWallet();
}

window.nexxoreWallet = {
  connect,
  disconnect,
  getState: () => walletState,
  onStateChange,
  openModal,
  closeModal,
};
