const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying Nexxore Vault...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deploy Mock Token (for testing) or use existing token address
  let tokenAddress = process.env.TOKEN_ADDRESS;

  if (!tokenAddress) {
    console.log("\n📝 No TOKEN_ADDRESS found, deploying mock token...");
    const Token = await hre.ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Test USDC", "USDC");
    await token.deployed();
    tokenAddress = token.address;
    console.log("Mock Token deployed to:", tokenAddress);
  }

  // Deploy Vault
  console.log("\n🏦 Deploying Nexxore Vault...");
  const Vault = await hre.ethers.getContractFactory("NexxoreVault");
  const vault = await Vault.deploy(tokenAddress);
  await vault.deployed();

  console.log("\n✅ Deployment Complete!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Vault Address:", vault.address);
  console.log("Asset Address:", tokenAddress);
  console.log("Network:", hre.network.name);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Wait for block confirmations before verifying
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("⏳ Waiting for block confirmations...");
    await vault.deployTransaction.wait(6);

    console.log("🔍 Verifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: vault.address,
        constructorArguments: [tokenAddress],
      });
      console.log("✅ Contract verified!");
    } catch (error) {
      console.log("❌ Verification failed:", error.message);
    }
  }

  // Save deployment info
  const fs = require("fs");
  const deploymentInfo = {
    network: hre.network.name,
    vault: vault.address,
    asset: tokenAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(
    `deployments/${hre.network.name}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log(`\n📄 Deployment info saved to deployments/${hre.network.name}.json`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
