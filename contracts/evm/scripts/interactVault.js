/**
 * Interactive Vault Operations Demo
 * Run after deploying the full system
 * 
 * Usage: npx hardhat run scripts/interactVault.js --network localhost
 */

const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("🔄 NEXXORE VAULT INTERACTION DEMO");
  console.log("=".repeat(70) + "\n");

  // Load deployment info
  const deploymentPath = "./deployments/localhost-full-system.json";
  if (!fs.existsSync(deploymentPath)) {
    console.log("❌ No deployment found. Run deployFullSystem.js first!");
    return;
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath));
  const contracts = deployment.contracts;

  const [deployer, user1, user2] = await ethers.getSigners();

  // Get contract instances
  const mockUSDC = await ethers.getContractAt("MockERC20", contracts.USDC);
  const nusd = await ethers.getContractAt("NUSD", contracts.NUSD);
  const collateralManager = await ethers.getContractAt("CollateralManager", contracts.CollateralManager);
  const vault = await ethers.getContractAt("BaseVault", contracts.SafeYieldVault);
  const priceFeed = await ethers.getContractAt("MockPriceFeed", contracts.ETHPriceFeed);

  // ============================================================
  // DEMO 1: Vault Deposit/Withdraw Flow
  // ============================================================
  console.log("📦 DEMO 1: Vault Operations\n");

  // Check current state
  let shares = await vault.balanceOf(deployer.address);
  let totalAssets = await vault.totalAssets();
  console.log("Current vault state:");
  console.log("  - Your shares:", ethers.formatUnits(shares, 6));
  console.log("  - Total assets:", ethers.formatUnits(totalAssets, 6), "USDC\n");

  // Deposit more USDC
  const depositAmount = ethers.parseUnits("5000", 6); // 5000 USDC
  await mockUSDC.approve(contracts.SafeYieldVault, depositAmount);
  await vault.deposit(depositAmount, deployer.address);
  console.log("✅ Deposited 5,000 more USDC");

  // Check share price
  const sharePrice = await vault.convertToAssets(ethers.parseUnits("1", 6));
  console.log("📊 Share price: 1 share =", ethers.formatUnits(sharePrice, 6), "USDC");

  // Check updated balances
  shares = await vault.balanceOf(deployer.address);
  totalAssets = await vault.totalAssets();
  console.log("\nUpdated vault state:");
  console.log("  - Your shares:", ethers.formatUnits(shares, 6));
  console.log("  - Total assets:", ethers.formatUnits(totalAssets, 6), "USDC");

  // Withdraw some
  const withdrawAmount = ethers.parseUnits("2000", 6); // 2000 USDC
  await vault.withdraw(withdrawAmount, deployer.address, deployer.address);
  console.log("\n✅ Withdrew 2,000 USDC");

  shares = await vault.balanceOf(deployer.address);
  totalAssets = await vault.totalAssets();
  console.log("  - Your shares now:", ethers.formatUnits(shares, 6));
  console.log("  - Total assets now:", ethers.formatUnits(totalAssets, 6), "USDC");

  // ============================================================
  // DEMO 2: Collateral Manager - Mint/Repay nUSD
  // ============================================================
  console.log("\n" + "-".repeat(50));
  console.log("📦 DEMO 2: Collateral & nUSD Operations\n");

  const ETH = "0x0000000000000000000000000000000000000000";

  // Check current position
  let position = await collateralManager.getPosition(deployer.address, ETH);
  console.log("Current position:");
  console.log("  - ETH collateral:", ethers.formatEther(position.collateralAmount), "ETH");
  console.log("  - nUSD debt:", ethers.formatEther(position.nUSDDebt), "nUSD");
  console.log("  - LTV:", (Number(position.currentLTV) / 100).toFixed(2) + "%");

  // Deposit more ETH
  const moreEth = ethers.parseEther("2");
  await collateralManager.depositETH({ value: moreEth });
  console.log("\n✅ Deposited 2 more ETH as collateral");

  // Check updated position
  position = await collateralManager.getPosition(deployer.address, ETH);
  console.log("Updated position:");
  console.log("  - ETH collateral:", ethers.formatEther(position.collateralAmount), "ETH");
  console.log("  - Max mintable:", ethers.formatEther(position.maxMintable), "nUSD");

  // Mint more nUSD
  const mintMore = ethers.parseEther("2000");
  await collateralManager.mintNUSD(ETH, mintMore);
  console.log("\n✅ Minted 2,000 more nUSD");

  // Check nUSD balance
  let nusdBal = await nusd.balanceOf(deployer.address);
  console.log("  - Total nUSD balance:", ethers.formatEther(nusdBal));

  // Check updated position after minting
  position = await collateralManager.getPosition(deployer.address, ETH);
  console.log("  - New LTV:", (Number(position.currentLTV) / 100).toFixed(2) + "%");

  // Repay some nUSD
  console.log("\n📌 Repaying 1,000 nUSD...");
  await nusd.approve(contracts.CollateralManager, ethers.parseEther("1000"));
  await collateralManager.redeemNUSD(ETH, ethers.parseEther("1000"));
  console.log("✅ Repaid 1,000 nUSD");

  // Final position
  position = await collateralManager.getPosition(deployer.address, ETH);
  nusdBal = await nusd.balanceOf(deployer.address);
  console.log("\nFinal position:");
  console.log("  - ETH collateral:", ethers.formatEther(position.collateralAmount), "ETH");
  console.log("  - nUSD debt:", ethers.formatEther(position.nUSDDebt), "nUSD");
  console.log("  - LTV:", (Number(position.currentLTV) / 100).toFixed(2) + "%");
  console.log("  - nUSD balance:", ethers.formatEther(nusdBal));

  // ============================================================
  // DEMO 3: Price Oracle Simulation
  // ============================================================
  console.log("\n" + "-".repeat(50));
  console.log("📦 DEMO 3: Price Oracle Simulation\n");

  // Get current price
  let priceData = await priceFeed.latestRoundData();
  console.log("Current ETH price: $" + ethers.formatUnits(priceData.answer, 8));

  // Simulate price drop (crash scenario)
  console.log("\n⚠️ Simulating ETH price crash to $1500...");
  await priceFeed.setPrice(ethers.parseUnits("1500", 8));
  
  priceData = await priceFeed.latestRoundData();
  console.log("New ETH price: $" + ethers.formatUnits(priceData.answer, 8));

  // Check liquidation status
  position = await collateralManager.getPosition(deployer.address, ETH);
  console.log("\nPosition after crash:");
  console.log("  - Collateral value: $" + ethers.formatUnits(position.collateralValueUSD, 8));
  console.log("  - LTV:", (Number(position.currentLTV) / 100).toFixed(2) + "%");
  console.log("  - Is liquidatable:", position.isLiquidatable);

  // Reset price
  await priceFeed.setPrice(ethers.parseUnits("2500", 8));
  console.log("\n✅ Price reset to $2500");

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(70));
  console.log("📊 FINAL SUMMARY");
  console.log("=".repeat(70));

  const usdcBal = await mockUSDC.balanceOf(deployer.address);
  shares = await vault.balanceOf(deployer.address);
  totalAssets = await vault.totalAssets();
  nusdBal = await nusd.balanceOf(deployer.address);
  position = await collateralManager.getPosition(deployer.address, ETH);
  const ethBalance = await ethers.provider.getBalance(deployer.address);

  console.log("\n💰 Deployer Balances:");
  console.log("  - ETH:", ethers.formatEther(ethBalance), "ETH");
  console.log("  - USDC:", ethers.formatUnits(usdcBal, 6), "USDC");
  console.log("  - nUSD:", ethers.formatEther(nusdBal), "nUSD");
  console.log("  - Vault shares:", ethers.formatUnits(shares, 6));

  console.log("\n🏦 Vault State:");
  console.log("  - Total assets:", ethers.formatUnits(totalAssets, 6), "USDC");

  console.log("\n📊 Collateral Position:");
  console.log("  - ETH locked:", ethers.formatEther(position.collateralAmount), "ETH");
  console.log("  - nUSD debt:", ethers.formatEther(position.nUSDDebt), "nUSD");
  console.log("  - LTV:", (Number(position.currentLTV) / 100).toFixed(2) + "%");

  console.log("\n✅ Demo complete!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
