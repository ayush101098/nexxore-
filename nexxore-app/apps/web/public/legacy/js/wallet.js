// Wallet Connection and Management
let provider = null;
let signer = null;
let userAddress = null;
let userAssets = [];

// Check if MetaMask is installed
function isMetaMaskInstalled() {
    const { ethereum } = window;
    return Boolean(ethereum && ethereum.isMetaMask);
}

// Initialize wallet connection
async function connectWallet() {
    console.log('Attempting to connect wallet...');
    
    try {
        // Check if MetaMask is installed
        if (!isMetaMaskInstalled()) {
            alert('MetaMask is not installed!\n\nPlease install MetaMask from:\nhttps://metamask.io/download/');
            window.open('https://metamask.io/download/', '_blank');
            return false;
        }

        console.log('MetaMask detected, requesting accounts...');

        // Request account access
        const accounts = await window.ethereum.request({ 
            method: 'eth_requestAccounts' 
        });
        
        if (!accounts || accounts.length === 0) {
            throw new Error('No accounts found. Please unlock MetaMask.');
        }

        userAddress = accounts[0];
        console.log('Connected to account:', userAddress);
        
        // Initialize provider and signer
        provider = new ethers.providers.Web3Provider(window.ethereum);
        signer = provider.getSigner();

        // Update UI
        updateWalletUI();
        
        // Load user assets
        await loadUserAssets();

        // Listen for account changes (remove old listeners first)
        if (window.ethereum.removeListener) {
            window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
            window.ethereum.removeListener('chainChanged', handleChainChanged);
        }
        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', handleChainChanged);

        console.log('Wallet connected successfully!');
        return true;
    } catch (error) {
        console.error('Error connecting wallet:', error);
        
        let errorMessage = 'Failed to connect wallet';
        if (error.code === 4001) {
            errorMessage = 'You rejected the connection request';
        } else if (error.code === -32002) {
            errorMessage = 'Please check MetaMask - a connection request is already pending';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        alert(errorMessage);
        return false;
    }
}

// Handle account changes
function handleAccountsChanged(accounts) {
    if (accounts.length === 0) {
        disconnectWallet();
    } else if (accounts[0] !== userAddress) {
        userAddress = accounts[0];
        updateWalletUI();
        loadUserAssets();
    }
}

// Handle chain changes
function handleChainChanged() {
    window.location.reload();
}

// Disconnect wallet
function disconnectWallet() {
    userAddress = null;
    provider = null;
    signer = null;
    userAssets = [];
    updateWalletUI();
}

// Update wallet UI
function updateWalletUI() {
    const connectBtns = document.querySelectorAll('#connectWalletBtn, #connectWallet');
    const walletInfo = document.getElementById('walletInfo');
    
    connectBtns.forEach(btn => {
        if (userAddress) {
            btn.textContent = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
            btn.classList.add('connected');
        } else {
            btn.textContent = 'Connect Wallet';
            btn.classList.remove('connected');
        }
    });

    if (walletInfo) {
        if (userAddress) {
            walletInfo.innerHTML = `
                <div class="connected-wallet">
                    <span class="wallet-indicator"></span>
                    <span class="wallet-address">${userAddress.slice(0, 6)}...${userAddress.slice(-4)}</span>
                    <button onclick="disconnectWallet()" class="disconnect-btn">Disconnect</button>
                </div>
            `;
            walletInfo.style.display = 'block';
        } else {
            walletInfo.style.display = 'none';
        }
    }
}

// Load user assets (ETH and tokens)
async function loadUserAssets() {
    if (!provider || !userAddress) return;

    try {
        userAssets = [];

        // Get ETH balance
        const ethBalance = await provider.getBalance(userAddress);
        userAssets.push({
            symbol: 'ETH',
            name: 'Ethereum',
            balance: ethers.utils.formatEther(ethBalance),
            address: ethers.constants.AddressZero,
            decimals: 18
        });

        // Common token addresses (you can add more)
        const tokens = [
            {
                address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
                symbol: 'USDT',
                name: 'Tether USD',
                decimals: 6
            },
            {
                address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6
            }
        ];

        // Check balances for each token
        for (const token of tokens) {
            try {
                const tokenContract = new ethers.Contract(
                    token.address,
                    ['function balanceOf(address) view returns (uint256)'],
                    provider
                );
                
                const balance = await tokenContract.balanceOf(userAddress);
                const formattedBalance = ethers.utils.formatUnits(balance, token.decimals);
                
                if (parseFloat(formattedBalance) > 0) {
                    userAssets.push({
                        ...token,
                        balance: formattedBalance
                    });
                }
            } catch (err) {
                console.warn(`Failed to load ${token.symbol}:`, err.message);
            }
        }

        // Update asset list in UI
        updateAssetList();

    } catch (error) {
        console.error('Error loading assets:', error);
    }
}

// Update asset list UI
function updateAssetList() {
    const assetList = document.getElementById('assetList');
    if (!assetList) return;

    if (userAssets.length === 0) {
        assetList.innerHTML = '<p style="text-align: center; color: #888;">No assets found</p>';
        return;
    }

    assetList.innerHTML = userAssets.map(asset => `
        <div class="asset-item" data-symbol="${asset.symbol}" data-address="${asset.address}">
            <div class="asset-info">
                <span class="asset-symbol">${asset.symbol}</span>
                <span class="asset-name">${asset.name}</span>
            </div>
            <div class="asset-balance">
                <span class="balance-amount">${parseFloat(asset.balance).toFixed(6)}</span>
                <button class="deposit-btn" onclick="selectAssetForDeposit('${asset.symbol}', '${asset.address}')">
                    Deposit
                </button>
            </div>
        </div>
    `).join('');
}

// Select asset for deposit
function selectAssetForDeposit(symbol, address) {
    const tokenSelect = document.getElementById('tokenSelect');
    if (tokenSelect) {
        tokenSelect.value = symbol;
    }
    
    // Scroll to deposit form
    const depositSection = document.getElementById('depositSection');
    if (depositSection) {
        depositSection.scrollIntoView({ behavior: 'smooth' });
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('Page loaded, initializing wallet...');
    
    // Check MetaMask installation
    if (!isMetaMaskInstalled()) {
        console.warn('MetaMask not detected');
        const connectBtns = document.querySelectorAll('#connectWalletBtn, #connectWallet');
        connectBtns.forEach(btn => {
            btn.innerHTML = '⚠️ Install MetaMask';
        });
    } else {
        console.log('MetaMask detected');
    }
    
    // Attach event listeners to connect wallet buttons
    const connectBtns = document.querySelectorAll('#connectWalletBtn, #connectWallet');
    console.log('Found', connectBtns.length, 'connect wallet buttons');
    
    connectBtns.forEach(btn => {
        // Remove any existing listeners
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        // Add new listener
        newBtn.addEventListener('click', async function(e) {
            e.preventDefault();
            console.log('Connect wallet button clicked');
            await connectWallet();
        });
    });

    // Check if already connected
    if (window.ethereum && window.ethereum.selectedAddress) {
        console.log('Wallet already connected, auto-connecting...');
        setTimeout(() => connectWallet(), 500);
    }
});

// Export for use in other files
window.walletConnector = {
    connect: connectWallet,
    disconnect: disconnectWallet,
    getProvider: () => provider,
    getSigner: () => signer,
    getAddress: () => userAddress,
    getAssets: () => userAssets
};
