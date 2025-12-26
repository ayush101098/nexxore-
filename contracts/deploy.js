const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying NexxoreYieldVault...\n");

  // Get deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log("📍 Deploying from:", deployer.address);
  console.log("💰 Balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH\n");

  // Deploy vault
  const NexxoreYieldVault = await hre.ethers.getContractFactory("NexxoreYieldVault");
  console.log("⏳ Deploying contract...");
  
  const vault = await NexxoreYieldVault.deploy();
  await vault.deployed();

  console.log("\n✅ NexxoreYieldVault deployed!");
  console.log("📝 Contract address:", vault.address);
  console.log("\n🔗 Add this to frontend/js/wallet.js line 12:");
  console.log(`   this.VAULT_ADDRESS = '${vault.address}';`);
  
  console.log("\n📊 Contract Details:");
  console.log("   Owner:", await vault.owner());
  console.log("   Paused:", await vault.paused());
  console.log("   TVL:", ethers.utils.formatEther(await vault.getTVL()), "ETH");

  // Verify on Basescan (if on mainnet)
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId === 8453 || network.chainId === 84532) {
    console.log("\n⏳ Waiting 30 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    try {
      await hre.run("verify:verify", {
        address: vault.address,
        constructorArguments: [],
      });
      console.log("✅ Contract verified on Basescan");
    } catch (error) {
      console.log("⚠️ Verification failed:", error.message);
      console.log("   You can verify manually at:");
      console.log(`   https://basescan.org/address/${vault.address}#code`);
    }
  }

  console.log("\n🎉 Deployment complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
