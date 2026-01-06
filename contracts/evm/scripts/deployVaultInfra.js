const hre = require("hardhat");

async function main() {
  console.log("Starting vault infrastructure deployment...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // ============ Deploy BaseVault Implementation ============
  console.log("Deploying BaseVault implementation...");
  const BaseVault = await ethers.getContractFactory("BaseVault");
  const vaultImplementation = await BaseVault.deploy();
  await vaultImplementation.waitForDeployment();
  const vaultImplAddress = await vaultImplementation.getAddress();
  console.log("✓ BaseVault implementation deployed to:", vaultImplAddress, "\n");

  // ============ Deploy VaultFactory ============
  console.log("Deploying VaultFactory...");
  const VaultFactory = await ethers.getContractFactory("VaultFactory");
  const factory = await VaultFactory.deploy(vaultImplAddress);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("✓ VaultFactory deployed to:", factoryAddress, "\n");

  // ============ Verification Summary ============
  console.log("=" .repeat(60));
  console.log("DEPLOYMENT SUMMARY");
  console.log("=" .repeat(60));
  console.log("Network:", hre.network.name);
  console.log("BaseVault Implementation:", vaultImplAddress);
  console.log("VaultFactory:", factoryAddress);
  console.log("=" .repeat(60), "\n");

  // ============ Save Deployment Info ============
  const deploymentInfo = {
    network: hre.network.name,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      BaseVaultImplementation: vaultImplAddress,
      VaultFactory: factoryAddress,
    },
  };

  const fs = require("fs");
  const deploymentPath = `./deployments/${hre.network.name}-deployment.json`;
  
  // Create deployments directory if it doesn't exist
  if (!fs.existsSync("./deployments")) {
    fs.mkdirSync("./deployments");
  }
  
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("✓ Deployment info saved to:", deploymentPath, "\n");

  // ============ Verification Instructions ============
  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    console.log("=" .repeat(60));
    console.log("VERIFICATION COMMANDS");
    console.log("=" .repeat(60));
    console.log("\nTo verify contracts on Etherscan, run:");
    console.log(`\nnpx hardhat verify --network ${hre.network.name} ${vaultImplAddress}`);
    console.log(`\nnpx hardhat verify --network ${hre.network.name} ${factoryAddress} ${vaultImplAddress}`);
    console.log("\n" + "=" .repeat(60));
  }

  // ============ Example Vault Creation ============
  console.log("\n📝 Example: Creating a test vault...");
  console.log("You can create vaults by calling:");
  console.log(`factory.createVault(assetAddress, "Vault Name", "SYMBOL", strategies[], weights[])`);
  console.log("\nExample code:");
  console.log(`
const factory = await ethers.getContractAt("VaultFactory", "${factoryAddress}");
const tx = await factory.createVault(
  "0xYourAssetAddress", // e.g., USDC
  "My Yield Vault",
  "MYV",
  [], // strategies (can be empty initially)
  []  // weights (can be empty initially)
);
const receipt = await tx.wait();
const vaultAddress = receipt.logs[0].address;
console.log("Vault created at:", vaultAddress);
  `);

  console.log("\n✓ Deployment complete!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
