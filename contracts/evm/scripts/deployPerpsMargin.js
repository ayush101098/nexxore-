const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying PerpsMargin with:', deployer.address);

  const collateral = process.env.PERPS_COLLATERAL || process.env.USDC_ADDRESS;
  if (!collateral) {
    throw new Error('Missing PERPS_COLLATERAL (ERC20) address');
  }

  const PerpsMargin = await hre.ethers.getContractFactory('PerpsMargin');
  const perps = await PerpsMargin.deploy(collateral);
  await perps.waitForDeployment();

  console.log('PerpsMargin deployed:', await perps.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
