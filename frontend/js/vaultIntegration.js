/**
 * Nexxore Vault Frontend Integration
 * Connects wallet and interacts with deployed contracts
 */

// ============================================================
// CONTRACT ADDRESSES - Update after deployment
// ============================================================
const CONTRACTS = {
  // Sepolia Testnet (update after deployment)
  sepolia: {
    chainId: 11155111,
    USDC: "",
    NUSD: "",
    CollateralManager: "",
    StrategyRouter: "",
    VaultFactory: "",
    SafeYieldVault: "",
    ETHPriceFeed: ""
  },
  // Localhost (Hardhat)
  localhost: {
    chainId: 31337,
    USDC: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    NUSD: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    CollateralManager: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    StrategyRouter: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    VaultFactory: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
    SafeYieldVault: "0x8aCd85898458400f7Db866d53FCFF6f0D49741FF",
    ETHPriceFeed: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853"
  }
};

// ============================================================
// CONTRACT ABIs (Simplified)
// ============================================================
const VAULT_ABI = [
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function asset() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

const COLLATERAL_MANAGER_ABI = [
  "function depositETH() payable",
  "function withdrawETH(address collateralToken, uint256 amount)",
  "function mintNUSD(address collateralToken, uint256 nUSDAmount)",
  "function redeemNUSD(address collateralToken, uint256 nUSDAmount)",
  "function getPosition(address user, address collateralToken) view returns (uint256 collateralAmount, uint256 nUSDDebt, uint256 collateralValueUSD, uint256 currentLTV, uint256 maxMintable, bool isLiquidatable)",
  "function maxLTV() view returns (uint256)",
  "function liquidationThreshold() view returns (uint256)"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)"
];

// ============================================================
// VAULT MANAGER CLASS
// ============================================================
class VaultManager {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.contracts = null;
    this.network = null;
    this.userAddress = null;
  }

  /**
   * Connect wallet and initialize contracts
   */
  async connect() {
    if (!window.ethereum) {
      throw new Error("MetaMask not installed");
    }

    // Request account access
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    
    this.provider = new ethers.BrowserProvider(window.ethereum);
    this.signer = await this.provider.getSigner();
    this.userAddress = await this.signer.getAddress();
    
    // Get network
    const network = await this.provider.getNetwork();
    const chainId = Number(network.chainId);
    
    // Find matching network config
    if (chainId === 11155111) {
      this.network = 'sepolia';
      this.contracts = CONTRACTS.sepolia;
    } else if (chainId === 31337) {
      this.network = 'localhost';
      this.contracts = CONTRACTS.localhost;
    } else {
      throw new Error(`Unsupported network: ${chainId}. Please switch to Sepolia or Localhost`);
    }

    console.log(`Connected to ${this.network} as ${this.userAddress}`);
    return { address: this.userAddress, network: this.network };
  }

  /**
   * Get contract instances
   */
  getVault() {
    return new ethers.Contract(this.contracts.SafeYieldVault, VAULT_ABI, this.signer);
  }

  getCollateralManager() {
    return new ethers.Contract(this.contracts.CollateralManager, COLLATERAL_MANAGER_ABI, this.signer);
  }

  getUSDC() {
    return new ethers.Contract(this.contracts.USDC, ERC20_ABI, this.signer);
  }

  getNUSD() {
    return new ethers.Contract(this.contracts.NUSD, ERC20_ABI, this.signer);
  }

  // ============================================================
  // VAULT OPERATIONS
  // ============================================================

  /**
   * Deposit USDC into vault
   */
  async depositToVault(amountUSDC) {
    const vault = this.getVault();
    const usdc = this.getUSDC();
    const amount = ethers.parseUnits(amountUSDC.toString(), 6);

    // Check allowance and approve if needed
    const allowance = await usdc.allowance(this.userAddress, this.contracts.SafeYieldVault);
    if (allowance < amount) {
      console.log("Approving USDC...");
      const approveTx = await usdc.approve(this.contracts.SafeYieldVault, amount);
      await approveTx.wait();
      console.log("Approved!");
    }

    // Deposit
    console.log(`Depositing ${amountUSDC} USDC...`);
    const tx = await vault.deposit(amount, this.userAddress);
    const receipt = await tx.wait();
    console.log("Deposit successful!", receipt.hash);
    return receipt;
  }

  /**
   * Withdraw USDC from vault
   */
  async withdrawFromVault(amountUSDC) {
    const vault = this.getVault();
    const amount = ethers.parseUnits(amountUSDC.toString(), 6);

    console.log(`Withdrawing ${amountUSDC} USDC...`);
    const tx = await vault.withdraw(amount, this.userAddress, this.userAddress);
    const receipt = await tx.wait();
    console.log("Withdrawal successful!", receipt.hash);
    return receipt;
  }

  /**
   * Get vault stats
   */
  async getVaultStats() {
    const vault = this.getVault();
    const usdc = this.getUSDC();

    const [shares, totalAssets, name, symbol, userUSDC] = await Promise.all([
      vault.balanceOf(this.userAddress),
      vault.totalAssets(),
      vault.name(),
      vault.symbol(),
      usdc.balanceOf(this.userAddress)
    ]);

    const shareValue = shares > 0n ? await vault.convertToAssets(shares) : 0n;

    return {
      name,
      symbol,
      userShares: ethers.formatUnits(shares, 6),
      userShareValue: ethers.formatUnits(shareValue, 6),
      totalAssets: ethers.formatUnits(totalAssets, 6),
      userUSDCBalance: ethers.formatUnits(userUSDC, 6)
    };
  }

  // ============================================================
  // COLLATERAL & nUSD OPERATIONS
  // ============================================================

  /**
   * Deposit ETH as collateral
   */
  async depositETHCollateral(amountETH) {
    const cm = this.getCollateralManager();
    const amount = ethers.parseEther(amountETH.toString());

    console.log(`Depositing ${amountETH} ETH as collateral...`);
    const tx = await cm.depositETH({ value: amount });
    const receipt = await tx.wait();
    console.log("Deposit successful!", receipt.hash);
    return receipt;
  }

  /**
   * Mint nUSD against ETH collateral
   */
  async mintNUSD(amountNUSD) {
    const cm = this.getCollateralManager();
    const amount = ethers.parseEther(amountNUSD.toString());
    const ETH = "0x0000000000000000000000000000000000000000";

    console.log(`Minting ${amountNUSD} nUSD...`);
    const tx = await cm.mintNUSD(ETH, amount);
    const receipt = await tx.wait();
    console.log("Mint successful!", receipt.hash);
    return receipt;
  }

  /**
   * Repay nUSD
   */
  async repayNUSD(amountNUSD) {
    const cm = this.getCollateralManager();
    const nusd = this.getNUSD();
    const amount = ethers.parseEther(amountNUSD.toString());
    const ETH = "0x0000000000000000000000000000000000000000";

    // Approve nUSD
    const allowance = await nusd.allowance(this.userAddress, this.contracts.CollateralManager);
    if (allowance < amount) {
      console.log("Approving nUSD...");
      const approveTx = await nusd.approve(this.contracts.CollateralManager, amount);
      await approveTx.wait();
    }

    console.log(`Repaying ${amountNUSD} nUSD...`);
    const tx = await cm.redeemNUSD(ETH, amount);
    const receipt = await tx.wait();
    console.log("Repay successful!", receipt.hash);
    return receipt;
  }

  /**
   * Get collateral position
   */
  async getCollateralPosition() {
    const cm = this.getCollateralManager();
    const nusd = this.getNUSD();
    const ETH = "0x0000000000000000000000000000000000000000";

    const [position, nusdBalance, ethBalance] = await Promise.all([
      cm.getPosition(this.userAddress, ETH),
      nusd.balanceOf(this.userAddress),
      this.provider.getBalance(this.userAddress)
    ]);

    return {
      collateralETH: ethers.formatEther(position.collateralAmount),
      debtNUSD: ethers.formatEther(position.nUSDDebt),
      collateralValueUSD: ethers.formatUnits(position.collateralValueUSD, 8),
      currentLTV: (Number(position.currentLTV) / 100).toFixed(2),
      maxMintable: ethers.formatEther(position.maxMintable),
      isLiquidatable: position.isLiquidatable,
      nusdBalance: ethers.formatEther(nusdBalance),
      ethBalance: ethers.formatEther(ethBalance)
    };
  }
}

// ============================================================
// UI HELPERS
// ============================================================
const vaultManager = new VaultManager();

// Format address for display
function formatAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Update UI with vault stats
async function updateVaultUI() {
  try {
    const stats = await vaultManager.getVaultStats();
    
    // Update UI elements if they exist
    const elements = {
      'vault-name': stats.name,
      'vault-symbol': stats.symbol,
      'user-shares': stats.userShares,
      'user-share-value': `$${stats.userShareValue}`,
      'total-assets': `$${stats.totalAssets}`,
      'usdc-balance': stats.userUSDCBalance
    };

    for (const [id, value] of Object.entries(elements)) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }
  } catch (error) {
    console.error("Error updating vault UI:", error);
  }
}

// Update UI with collateral position
async function updateCollateralUI() {
  try {
    const position = await vaultManager.getCollateralPosition();
    
    const elements = {
      'eth-collateral': `${position.collateralETH} ETH`,
      'nusd-debt': `${position.debtNUSD} nUSD`,
      'collateral-value': `$${position.collateralValueUSD}`,
      'current-ltv': `${position.currentLTV}%`,
      'max-mintable': `${position.maxMintable} nUSD`,
      'nusd-balance': position.nusdBalance,
      'eth-balance': position.ethBalance
    };

    for (const [id, value] of Object.entries(elements)) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }

    // Update liquidation warning
    const warning = document.getElementById('liquidation-warning');
    if (warning) {
      warning.style.display = position.isLiquidatable ? 'block' : 'none';
    }
  } catch (error) {
    console.error("Error updating collateral UI:", error);
  }
}

// Export for use in HTML
window.VaultManager = VaultManager;
window.vaultManager = vaultManager;
window.updateVaultUI = updateVaultUI;
window.updateCollateralUI = updateCollateralUI;
window.formatAddress = formatAddress;

console.log("🏦 Nexxore Vault Integration loaded!");
console.log("Usage: await vaultManager.connect()");
