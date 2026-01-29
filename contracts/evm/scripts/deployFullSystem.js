/**
 * Full System Deployment Script
 * Deploys the complete Nexxore vault infrastructure:
 * - NUSD (stablecoin)
 * - CollateralManager
 * - StrategyRouter
 * - Mock tokens for testing
 * - A complete SafeYield vault with strategy
 */

const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 NEXXORE FULL SYSTEM DEPLOYMENT");
  console.log("=".repeat(70) + "\n");

  const [deployer, user1, user2] = await ethers.getSigners();
  console.log("📍 Deployer:", deployer.address);
  console.log("📍 Test User 1:", user1?.address || "N/A");
  console.log("📍 Test User 2:", user2?.address || "N/A");
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Deployer Balance:", ethers.formatEther(balance), "ETH\n");

  const deployed = {};

  // ============================================================
  // STEP 1: Deploy Mock Tokens for Testing
  // ============================================================
  console.log("📦 STEP 1: Deploying Mock Tokens...\n");

  // Deploy MockERC20 for USDC
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  
  const mockUSDC = await MockERC20.deploy("Mock USDC", "USDC", 6);
  await mockUSDC.waitForDeployment();
  deployed.USDC = await mockUSDC.getAddress();
  console.log("✅ Mock USDC deployed:", deployed.USDC);

  const mockWETH = await MockERC20.deploy("Wrapped ETH", "WETH", 18);
  await mockWETH.waitForDeployment();
  deployed.WETH = await mockWETH.getAddress();
  console.log("✅ Mock WETH deployed:", deployed.WETH);

  const mockDAI = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);
  await mockDAI.waitForDeployment();
  deployed.DAI = await mockDAI.getAddress();
  console.log("✅ Mock DAI deployed:", deployed.DAI);

  // ============================================================
  // STEP 2: Deploy Core Protocol
  // ============================================================
  console.log("\n📦 STEP 2: Deploying Core Protocol...\n");

  // Deploy NUSD Stablecoin
  const NUSD = await ethers.getContractFactory("NUSD");
  const nusd = await NUSD.deploy();
  await nusd.waitForDeployment();
  deployed.NUSD = await nusd.getAddress();
  console.log("✅ NUSD deployed:", deployed.NUSD);

  // Deploy CollateralManager
  const CollateralManager = await ethers.getContractFactory("CollateralManager");
  const collateralManager = await CollateralManager.deploy(deployed.NUSD);
  await collateralManager.waitForDeployment();
  deployed.CollateralManager = await collateralManager.getAddress();
  console.log("✅ CollateralManager deployed:", deployed.CollateralManager);

  // Grant MINTER_ROLE to CollateralManager
  const MINTER_ROLE = await nusd.MINTER_ROLE();
  await nusd.grantRole(MINTER_ROLE, deployed.CollateralManager);
  console.log("✅ MINTER_ROLE granted to CollateralManager");

  // Deploy StrategyRouter
  const StrategyRouter = await ethers.getContractFactory("StrategyRouter");
  const strategyRouter = await StrategyRouter.deploy(deployed.CollateralManager);
  await strategyRouter.waitForDeployment();
  deployed.StrategyRouter = await strategyRouter.getAddress();
  console.log("✅ StrategyRouter deployed:", deployed.StrategyRouter);

  // Deploy Mock Price Feed for ETH (ETH/USD at $2500)
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const ethPriceFeed = await MockPriceFeed.deploy(
    ethers.parseUnits("2500", 8), // $2500 with 8 decimals
    8,
    "ETH / USD"
  );
  await ethPriceFeed.waitForDeployment();
  deployed.ETHPriceFeed = await ethPriceFeed.getAddress();
  console.log("✅ ETH Price Feed deployed:", deployed.ETHPriceFeed);

  // Set ETH price feed (ETH is already added as collateral in constructor)
  await collateralManager.setPriceFeed(
    "0x0000000000000000000000000000000000000000", // ETH = address(0)
    deployed.ETHPriceFeed
  );
  console.log("✅ ETH price feed configured");

  // ============================================================
  // STEP 3: Deploy Vault Infrastructure
  // ============================================================
  console.log("\n📦 STEP 3: Deploying Vault Infrastructure...\n");

  // Deploy VaultFactory
  const VaultFactory = await ethers.getContractFactory("VaultFactory");
  const vaultFactory = await VaultFactory.deploy();
  await vaultFactory.waitForDeployment();
  deployed.VaultFactory = await vaultFactory.getAddress();
  console.log("✅ VaultFactory deployed:", deployed.VaultFactory);

  // ============================================================
  // STEP 4: Create Safe Yield Vault (USDC)
  // ============================================================
  console.log("\n📦 STEP 4: Creating Safe Yield Vault...\n");

  const factory = await ethers.getContractAt("VaultFactory", deployed.VaultFactory);
  
  // Create USDC vault
  const createVaultTx = await factory.createVault(
    deployed.USDC,
    "Nexxore Safe Yield USDC",
    "nxUSDC",
    [], // No strategies yet
    []  // No weights yet
  );
  const receipt = await createVaultTx.wait();
  
  // Get vault address from event
  const vaultCreatedEvent = receipt.logs.find(
    log => log.fragment?.name === "VaultCreated"
  );
  deployed.SafeYieldVault = vaultCreatedEvent?.args?.[0] || receipt.logs[0]?.address;
  console.log("✅ Safe Yield Vault created:", deployed.SafeYieldVault);

  // ============================================================
  // STEP 5: Fund Test Accounts
  // ============================================================
  console.log("\n📦 STEP 5: Funding Test Accounts...\n");

  // Mint USDC to deployer and users
  const mintAmount = ethers.parseUnits("100000", 6); // 100k USDC
  await mockUSDC.mint(deployer.address, mintAmount);
  console.log("✅ Minted 100,000 USDC to deployer");

  if (user1) {
    await mockUSDC.mint(user1.address, mintAmount);
    console.log("✅ Minted 100,000 USDC to user1");
  }

  // Mint WETH
  const wethAmount = ethers.parseUnits("100", 18); // 100 WETH
  await mockWETH.mint(deployer.address, wethAmount);
  console.log("✅ Minted 100 WETH to deployer");

  // ============================================================
  // STEP 6: Test Vault Operations
  // ============================================================
  console.log("\n📦 STEP 6: Testing Vault Operations...\n");

  const vault = await ethers.getContractAt("BaseVault", deployed.SafeYieldVault);

  // Approve vault to spend USDC
  const depositAmount = ethers.parseUnits("1000", 6); // 1000 USDC
  await mockUSDC.approve(deployed.SafeYieldVault, depositAmount);
  console.log("✅ Approved vault to spend 1,000 USDC");

  // Deposit into vault
  const depositTx = await vault.deposit(depositAmount, deployer.address);
  await depositTx.wait();
  console.log("✅ Deposited 1,000 USDC into vault");

  // Check shares
  const shares = await vault.balanceOf(deployer.address);
  console.log("✅ Received", ethers.formatUnits(shares, 6), "vault shares");

  // Check total assets
  const totalAssets = await vault.totalAssets();
  console.log("✅ Vault total assets:", ethers.formatUnits(totalAssets, 6), "USDC");

  // ============================================================
  // STEP 7: Test Collateral Manager (ETH -> nUSD)
  // ============================================================
  console.log("\n📦 STEP 7: Testing Collateral Manager...\n");

  // Deposit ETH as collateral
  const ethDeposit = ethers.parseEther("1"); // 1 ETH
  const depositEthTx = await collateralManager.depositETH({ value: ethDeposit });
  await depositEthTx.wait();
  console.log("✅ Deposited 1 ETH as collateral");

  // Check position using getPosition function
  const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
  const position = await collateralManager.getPosition(deployer.address, ETH_ADDRESS);
  console.log("✅ Collateral balance:", ethers.formatEther(position.collateralAmount), "ETH");
  console.log("✅ Collateral value USD: $" + ethers.formatUnits(position.collateralValueUSD, 8));
  console.log("✅ Max mintable nUSD:", ethers.formatEther(position.maxMintable));

  // Mint nUSD (at ~75% LTV = safe level)
  const nusdToMint = ethers.parseEther("1000"); // Mint 1000 nUSD ($1000 against $2500 collateral = 40% LTV)
  const mintTx = await collateralManager.mintNUSD(ETH_ADDRESS, nusdToMint);
  await mintTx.wait();
  console.log("✅ Minted 1,000 nUSD");

  // Check nUSD balance
  const nusdBalance = await nusd.balanceOf(deployer.address);
  console.log("✅ nUSD balance:", ethers.formatEther(nusdBalance));

  // Check updated position
  const positionAfter = await collateralManager.getPosition(deployer.address, ETH_ADDRESS);
  console.log("✅ Debt:", ethers.formatEther(positionAfter.nUSDDebt), "nUSD");
  console.log("✅ Current LTV:", (Number(positionAfter.currentLTV) / 100).toFixed(2) + "%");

  // ============================================================
  // DEPLOYMENT COMPLETE - SAVE INFO
  // ============================================================
  console.log("\n" + "=".repeat(70));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(70));
  
  console.log("\n📋 DEPLOYED CONTRACTS:");
  console.log("-".repeat(50));
  Object.entries(deployed).forEach(([name, address]) => {
    console.log(`  ${name.padEnd(20)} ${address}`);
  });
  console.log("-".repeat(50));

  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: deployed,
    testResults: {
      vaultDeposit: "1000 USDC",
      vaultShares: ethers.formatUnits(shares, 6),
      ethCollateral: "1 ETH",
      nusdMinted: "500 nUSD"
    }
  };

  // Create deployments directory
  if (!fs.existsSync("./deployments")) {
    fs.mkdirSync("./deployments", { recursive: true });
  }

  const filename = `./deployments/${hre.network.name}-full-system.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log("\n✅ Deployment info saved to:", filename);

  // ============================================================
  // INTERACTION GUIDE
  // ============================================================
  console.log("\n" + "=".repeat(70));
  console.log("📘 INTERACTION GUIDE");
  console.log("=".repeat(70));
  
  console.log(`
┌─────────────────────────────────────────────────────────────────────┐
│  VAULT OPERATIONS                                                    │
├─────────────────────────────────────────────────────────────────────┤
│  Deposit USDC:                                                       │
│    1. Approve: mockUSDC.approve(vault, amount)                       │
│    2. Deposit: vault.deposit(amount, receiver)                       │
│                                                                      │
│  Withdraw USDC:                                                      │
│    vault.withdraw(assets, receiver, owner)                           │
│                                                                      │
│  Check Balance:                                                      │
│    vault.balanceOf(address)     // shares                            │
│    vault.totalAssets()          // total vault value                 │
├─────────────────────────────────────────────────────────────────────┤
│  COLLATERAL & nUSD OPERATIONS                                        │
├─────────────────────────────────────────────────────────────────────┤
│  Deposit ETH:                                                        │
│    collateralManager.depositETH({ value: ethAmount })                │
│                                                                      │
│  Mint nUSD:                                                          │
│    collateralManager.mintNUSD(amount)                                │
│                                                                      │
│  Repay & Withdraw:                                                   │
│    collateralManager.redeemNUSD(nusdAmount)                          │
│    collateralManager.withdrawETH(ethAmount)                          │
└─────────────────────────────────────────────────────────────────────┘
  `);

  console.log("\n✅ Full system ready for testing!\n");

  return deployed;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
