/**
 * Sepolia Deployment Script
 * Deploys the complete Nexxore vault system to Sepolia testnet
 * 
 * Run: npx hardhat run scripts/deploySepolia.js --network sepolia
 */

const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 NEXXORE SEPOLIA DEPLOYMENT");
  console.log("=".repeat(70) + "\n");

  const [deployer] = await ethers.getSigners();
  console.log("📍 Deployer:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "ETH\n");

  if (balance < ethers.parseEther("0.05")) {
    console.log("❌ Insufficient balance! Need at least 0.05 ETH");
    console.log("Get Sepolia ETH from: https://sepoliafaucet.com");
    return;
  }

  const deployed = {};

  try {
    // ============================================================
    // STEP 1: Deploy Mock Tokens (for testing)
    // ============================================================
    console.log("📦 STEP 1: Deploying Mock Tokens...\n");

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    
    const mockUSDC = await MockERC20.deploy("Mock USDC", "USDC", 6);
    await mockUSDC.waitForDeployment();
    deployed.USDC = await mockUSDC.getAddress();
    console.log("✅ Mock USDC:", deployed.USDC);

    // ============================================================
    // STEP 2: Deploy Core Protocol
    // ============================================================
    console.log("\n📦 STEP 2: Deploying Core Protocol...\n");

    // Deploy NUSD
    const NUSD = await ethers.getContractFactory("NUSD");
    const nusd = await NUSD.deploy();
    await nusd.waitForDeployment();
    deployed.NUSD = await nusd.getAddress();
    console.log("✅ NUSD:", deployed.NUSD);

    // Deploy CollateralManager
    const CollateralManager = await ethers.getContractFactory("CollateralManager");
    const collateralManager = await CollateralManager.deploy(deployed.NUSD);
    await collateralManager.waitForDeployment();
    deployed.CollateralManager = await collateralManager.getAddress();
    console.log("✅ CollateralManager:", deployed.CollateralManager);

    // Grant MINTER_ROLE to CollateralManager
    const MINTER_ROLE = await nusd.MINTER_ROLE();
    await nusd.grantRole(MINTER_ROLE, deployed.CollateralManager);
    console.log("✅ MINTER_ROLE granted");

    // Deploy StrategyRouter
    const StrategyRouter = await ethers.getContractFactory("StrategyRouter");
    const strategyRouter = await StrategyRouter.deploy(deployed.CollateralManager);
    await strategyRouter.waitForDeployment();
    deployed.StrategyRouter = await strategyRouter.getAddress();
    console.log("✅ StrategyRouter:", deployed.StrategyRouter);

    // Deploy Mock Price Feed
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const ethPriceFeed = await MockPriceFeed.deploy(
      ethers.parseUnits("2500", 8),
      8,
      "ETH / USD"
    );
    await ethPriceFeed.waitForDeployment();
    deployed.ETHPriceFeed = await ethPriceFeed.getAddress();
    console.log("✅ ETH Price Feed:", deployed.ETHPriceFeed);

    // Set price feed for ETH
    const ETH = "0x0000000000000000000000000000000000000000";
    await collateralManager.setPriceFeed(ETH, deployed.ETHPriceFeed);
    console.log("✅ ETH price feed configured");

    // ============================================================
    // STEP 3: Deploy Vault Infrastructure
    // ============================================================
    console.log("\n📦 STEP 3: Deploying Vault Infrastructure...\n");

    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    const vaultFactory = await VaultFactory.deploy();
    await vaultFactory.waitForDeployment();
    deployed.VaultFactory = await vaultFactory.getAddress();
    console.log("✅ VaultFactory:", deployed.VaultFactory);

    // ============================================================
    // STEP 4: Create Safe Yield Vault
    // ============================================================
    console.log("\n📦 STEP 4: Creating Safe Yield Vault...\n");

    const factory = await ethers.getContractAt("VaultFactory", deployed.VaultFactory);
    const createVaultTx = await factory.createVault(
      deployed.USDC,
      "Nexxore Safe Yield USDC",
      "nxUSDC",
      [],
      []
    );
    const receipt = await createVaultTx.wait();
    
    // Get vault address from event
    const vaultCreatedEvent = receipt.logs.find(
      log => log.fragment?.name === "VaultCreated"
    );
    deployed.SafeYieldVault = vaultCreatedEvent?.args?.[0] || receipt.logs[0]?.address;
    console.log("✅ Safe Yield Vault:", deployed.SafeYieldVault);

    // ============================================================
    // STEP 5: Mint test tokens
    // ============================================================
    console.log("\n📦 STEP 5: Minting Test Tokens...\n");

    const mintAmount = ethers.parseUnits("10000", 6);
    await mockUSDC.mint(deployer.address, mintAmount);
    console.log("✅ Minted 10,000 USDC to deployer");

    // ============================================================
    // SAVE DEPLOYMENT
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
      network: "sepolia",
      chainId: 11155111,
      timestamp: new Date().toISOString(),
      deployer: deployer.address,
      contracts: deployed
    };

    if (!fs.existsSync("./deployments")) {
      fs.mkdirSync("./deployments", { recursive: true });
    }

    const filename = "./deployments/sepolia-deployment.json";
    fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
    console.log("\n✅ Saved to:", filename);

    // Update frontend config
    console.log("\n📝 UPDATE FRONTEND CONFIG:");
    console.log("-".repeat(50));
    console.log("Copy these addresses to frontend/js/vaultIntegration.js:");
    console.log(`
  sepolia: {
    chainId: 11155111,
    USDC: "${deployed.USDC}",
    NUSD: "${deployed.NUSD}",
    CollateralManager: "${deployed.CollateralManager}",
    StrategyRouter: "${deployed.StrategyRouter}",
    VaultFactory: "${deployed.VaultFactory}",
    SafeYieldVault: "${deployed.SafeYieldVault}",
    ETHPriceFeed: "${deployed.ETHPriceFeed}"
  }
    `);

    // Verify instructions
    if (process.env.ETHERSCAN_API_KEY) {
      console.log("\n🔍 VERIFY CONTRACTS:");
      console.log(`npx hardhat verify --network sepolia ${deployed.NUSD}`);
      console.log(`npx hardhat verify --network sepolia ${deployed.USDC} "Mock USDC" "USDC" 6`);
    }

    console.log("\n✅ Deployment complete!\n");

  } catch (error) {
    console.error("\n❌ Deployment failed:", error.message);
    
    // Save partial deployment
    if (Object.keys(deployed).length > 0) {
      const filename = "./deployments/sepolia-partial.json";
      fs.writeFileSync(filename, JSON.stringify({
        timestamp: new Date().toISOString(),
        contracts: deployed,
        error: error.message
      }, null, 2));
      console.log("Partial deployment saved to:", filename);
    }
    
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
