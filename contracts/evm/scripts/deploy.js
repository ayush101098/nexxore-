const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying Nexxore Vault...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  // Deploy Vault
  console.log("\n🏦 Deploying Nexxore Vault...");
  const Vault = await hre.ethers.getContractFactory("NexxoreVault");
  const vault = await Vault.deploy();
  await vault.waitForDeployment();
  
  const vaultAddress = await vault.getAddress();

  console.log("\n✅ Deployment Complete!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Vault Address:", vaultAddress);
  console.log("Network:", hre.network.name);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Wait for block confirmations before verifying
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("⏳ Waiting for block confirmations...");
    await vault.deploymentTransaction().wait(6);

    console.log("🔍 Verifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: vaultAddress,
        constructorArguments: [],
      });
      console.log("✅ Contract verified!");
    } catch (error) {
      console.log("❌ Verification failed:", error.message);
    }
  }

  console.log("\n📝 Update frontend/deposit.html with:");
  console.log(`const VAULT_ADDRESS = '${vaultAddress}';`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
