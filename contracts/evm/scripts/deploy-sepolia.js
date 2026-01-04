/**
 * SafeYield Vault Deployment Script
 * Deploys all contracts to Sepolia testnet
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Starting SafeYield Vault Deployment to Sepolia...\n");

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH\n");

  if (balance < hre.ethers.parseEther("0.01")) {
    console.log("⚠️  Low balance! Get Sepolia ETH from:");
    console.log("   https://sepoliafaucet.com");
    console.log("   https://www.alchemy.com/faucets/ethereum-sepolia");
    return;
  }

  const deployedContracts = {};

  // ========================================
  // 1. Deploy Mock USDC (for testnet)
  // ========================================
  console.log("1️⃣  Deploying Mock USDC...");
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC");
  await usdc.waitForDeployment();
  deployedContracts.USDC = await usdc.getAddress();
  console.log("   ✅ Mock USDC:", deployedContracts.USDC);

  // Mint initial USDC to deployer (1 million USDC - using 18 decimals for mock)
  const mintAmount = hre.ethers.parseUnits("1000000", 18);
  await usdc.mint(deployer.address, mintAmount);
  console.log("   💰 Minted 1,000,000 USDC to deployer\n");

  // ========================================
  // 2. Deploy Risk Oracle
  // ========================================
  console.log("2️⃣  Deploying Risk Oracle...");
  const RiskOracle = await hre.ethers.getContractFactory("RiskOracle");
  const riskOracle = await RiskOracle.deploy(deployer.address);
  await riskOracle.waitForDeployment();
  deployedContracts.RiskOracle = await riskOracle.getAddress();
  console.log("   ✅ Risk Oracle:", deployedContracts.RiskOracle, "\n");

  // ========================================
  // 3. Deploy SafeYield Vault
  // ========================================
  console.log("3️⃣  Deploying SafeYield Vault...");
  const SafeYieldVault = await hre.ethers.getContractFactory("SafeYieldVault");
  const vault = await SafeYieldVault.deploy(
    deployedContracts.USDC,          // asset (USDC)
    "SafeYield USDC",                // name
    "syUSDC",                        // symbol  
    deployer.address,                // governance
    deployer.address                 // feeRecipient
  );
  await vault.waitForDeployment();
  deployedContracts.SafeYieldVault = await vault.getAddress();
  console.log("   ✅ SafeYield Vault:", deployedContracts.SafeYieldVault, "\n");

  // ========================================
  // 4. Deploy Strategies (Simplified for testnet)
  // ========================================
  console.log("4️⃣  Deploying Strategies...");
  
  // For testnet, we'll deploy simplified mock strategies
  // In production, these would connect to real Aave/Compound
  
  const MockStrategy = await hre.ethers.getContractFactory("MockERC20");
  
  // Deploy mock strategies (using MockERC20 as placeholder)
  // In production, use the actual strategy contracts
  
  console.log("   ℹ️  Note: Using mock strategies for testnet");
  console.log("   ℹ️  Production would use AaveLendingStrategy, etc.\n");

  // ========================================
  // 5. Configure Vault
  // ========================================
  console.log("5️⃣  Configuring Vault...");
  
  // Grant roles
  const RISK_AGENT = await vault.RISK_AGENT();
  const EXECUTION_AGENT = await vault.EXECUTION_AGENT();
  const RESEARCH_AGENT = await vault.RESEARCH_AGENT();
  
  // For testnet, deployer has all roles
  await vault.grantRole(RISK_AGENT, deployer.address);
  await vault.grantRole(EXECUTION_AGENT, deployer.address);
  await vault.grantRole(RESEARCH_AGENT, deployer.address);
  
  console.log("   ✅ Granted all agent roles to deployer\n");

  // ========================================
  // 6. Initial Deposit Test
  // ========================================
  console.log("6️⃣  Testing Initial Deposit...");
  
  const testDeposit = hre.ethers.parseUnits("1000", 18); // 1000 USDC (18 decimals for mock)
  
  // Approve vault to spend USDC
  await usdc.approve(deployedContracts.SafeYieldVault, testDeposit);
  console.log("   ✅ Approved 1,000 USDC");
  
  // Deposit
  await vault.deposit(testDeposit, deployer.address);
  console.log("   ✅ Deposited 1,000 USDC");
  
  // Check balance
  const shares = await vault.balanceOf(deployer.address);
  const assets = await vault.convertToAssets(shares);
  console.log("   💰 Received:", hre.ethers.formatUnits(shares, 18), "syUSDC");
  console.log("   💰 Value:", hre.ethers.formatUnits(assets, 18), "USDC\n");

  // ========================================
  // 7. Save Deployment Info
  // ========================================
  console.log("7️⃣  Saving deployment info...");
  
  const deployment = {
    network: "sepolia",
    chainId: 11155111,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: deployedContracts,
    blockExplorer: {
      USDC: `https://sepolia.etherscan.io/address/${deployedContracts.USDC}`,
      RiskOracle: `https://sepolia.etherscan.io/address/${deployedContracts.RiskOracle}`,
      SafeYieldVault: `https://sepolia.etherscan.io/address/${deployedContracts.SafeYieldVault}`,
    }
  };

  const deploymentPath = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentPath)) {
    fs.mkdirSync(deploymentPath, { recursive: true });
  }
  
  fs.writeFileSync(
    path.join(deploymentPath, "sepolia.json"),
    JSON.stringify(deployment, null, 2)
  );
  console.log("   ✅ Saved to contracts/evm/deployments/sepolia.json\n");

  // ========================================
  // Summary
  // ========================================
  console.log("═".repeat(50));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("═".repeat(50));
  console.log("\n📋 Contract Addresses:");
  console.log("   USDC:           ", deployedContracts.USDC);
  console.log("   Risk Oracle:    ", deployedContracts.RiskOracle);
  console.log("   SafeYield Vault:", deployedContracts.SafeYieldVault);
  console.log("\n🔗 View on Etherscan:");
  console.log("   " + deployment.blockExplorer.SafeYieldVault);
  console.log("\n📝 Next Steps:");
  console.log("   1. Get test USDC: Mint more with MockERC20.mint()");
  console.log("   2. Deposit: vault.deposit(amount, yourAddress)");
  console.log("   3. Check balance: vault.balanceOf(yourAddress)");
  console.log("   4. Withdraw: vault.withdraw(amount, yourAddress, yourAddress)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
