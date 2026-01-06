const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VaultFactory", function () {
  let factory;
  let mockToken;
  let owner;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock ERC20 token (18 decimals by default)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock USDC", "USDC");
    await mockToken.waitForDeployment();

    // Deploy factory (no implementation needed for direct deployment)
    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    factory = await VaultFactory.deploy();
    await factory.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("Should start with zero vaults", async function () {
      expect(await factory.vaultCount()).to.equal(0);
    });
  });

  describe("Vault Creation", function () {
    it("Should create a new vault successfully", async function () {
      const tx = await factory.createVault(
        await mockToken.getAddress(),
        "Test Vault",
        "TVAULT",
        [],
        []
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => log.fragment && log.fragment.name === "VaultCreated"
      );

      expect(event).to.not.be.undefined;
      expect(await factory.vaultCount()).to.equal(1);
    });

    it("Should emit VaultCreated event with correct parameters", async function () {
      await expect(
        factory.createVault(
          await mockToken.getAddress(),
          "Test Vault",
          "TVAULT",
          [],
          []
        )
      )
        .to.emit(factory, "VaultCreated")
        .withArgs(
          (value) => value !== ethers.ZeroAddress, // vault address
          owner.address, // creator
          await mockToken.getAddress(), // asset
          "Test Vault",
          "TVAULT",
          (value) => value > 0 // timestamp
        );
    });

    it("Should revert with zero address asset", async function () {
      await expect(
        factory.createVault(ethers.ZeroAddress, "Test", "TEST", [], [])
      ).to.be.revertedWithCustomError(factory, "InvalidAsset");
    });

    it("Should register vault correctly", async function () {
      const tx = await factory.createVault(
        await mockToken.getAddress(),
        "Test Vault",
        "TVAULT",
        [],
        []
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => log.fragment && log.fragment.name === "VaultCreated"
      );
      const vaultAddress = event.args[0];

      expect(await factory.isVault(vaultAddress)).to.be.true;
    });

    it("Should store correct metadata", async function () {
      const tx = await factory.createVault(
        await mockToken.getAddress(),
        "Test Vault",
        "TVAULT",
        [],
        []
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => log.fragment && log.fragment.name === "VaultCreated"
      );
      const vaultAddress = event.args[0];

      const metadata = await factory.getVaultMetadata(vaultAddress);
      expect(metadata.name).to.equal("Test Vault");
      expect(metadata.symbol).to.equal("TVAULT");
      expect(metadata.asset).to.equal(await mockToken.getAddress());
      expect(metadata.creator).to.equal(owner.address);
      expect(metadata.active).to.be.true;
    });

    it("Should create multiple vaults", async function () {
      await factory.createVault(
        await mockToken.getAddress(),
        "Vault 1",
        "V1",
        [],
        []
      );
      await factory.createVault(
        await mockToken.getAddress(),
        "Vault 2",
        "V2",
        [],
        []
      );
      await factory.createVault(
        await mockToken.getAddress(),
        "Vault 3",
        "V3",
        [],
        []
      );

      expect(await factory.vaultCount()).to.equal(3);
    });
  });

  describe("Vault Management", function () {
    let vaultAddress;

    beforeEach(async function () {
      const tx = await factory.createVault(
        await mockToken.getAddress(),
        "Test Vault",
        "TVAULT",
        [],
        []
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => log.fragment && log.fragment.name === "VaultCreated"
      );
      vaultAddress = event.args[0];
    });

    it("Should deactivate vault (owner only)", async function () {
      await expect(factory.deactivateVault(vaultAddress))
        .to.emit(factory, "VaultDeactivated")
        .withArgs(vaultAddress, (value) => value > 0);

      const metadata = await factory.getVaultMetadata(vaultAddress);
      expect(metadata.active).to.be.false;
    });

    it("Should revert when non-owner tries to deactivate", async function () {
      await expect(
        factory.connect(user1).deactivateVault(vaultAddress)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Should revert when deactivating non-existent vault", async function () {
      await expect(
        factory.deactivateVault(user1.address)
      ).to.be.revertedWithCustomError(factory, "VaultNotFound");
    });

    it("Should revert when deactivating already deactivated vault", async function () {
      await factory.deactivateVault(vaultAddress);
      await expect(
        factory.deactivateVault(vaultAddress)
      ).to.be.revertedWithCustomError(factory, "VaultAlreadyDeactivated");
    });
  });

  describe("View Functions", function () {
    let vault1, vault2, vault3;

    beforeEach(async function () {
      const tx1 = await factory.createVault(
        await mockToken.getAddress(),
        "Vault 1",
        "V1",
        [],
        []
      );
      const receipt1 = await tx1.wait();
      vault1 = receipt1.logs.find(
        (log) => log.fragment && log.fragment.name === "VaultCreated"
      ).args[0];

      const tx2 = await factory
        .connect(user1)
        .createVault(await mockToken.getAddress(), "Vault 2", "V2", [], []);
      const receipt2 = await tx2.wait();
      vault2 = receipt2.logs.find(
        (log) => log.fragment && log.fragment.name === "VaultCreated"
      ).args[0];

      const tx3 = await factory.createVault(
        await mockToken.getAddress(),
        "Vault 3",
        "V3",
        [],
        []
      );
      const receipt3 = await tx3.wait();
      vault3 = receipt3.logs.find(
        (log) => log.fragment && log.fragment.name === "VaultCreated"
      ).args[0];
    });

    it("Should return all vaults", async function () {
      const allVaults = await factory.getAllVaults();
      expect(allVaults.length).to.equal(3);
      expect(allVaults).to.include(vault1);
      expect(allVaults).to.include(vault2);
      expect(allVaults).to.include(vault3);
    });

    it("Should return active vaults only", async function () {
      await factory.deactivateVault(vault2);

      const activeVaults = await factory.getActiveVaults();
      expect(activeVaults.length).to.equal(2);
      expect(activeVaults).to.include(vault1);
      expect(activeVaults).to.include(vault3);
      expect(activeVaults).to.not.include(vault2);
    });

    it("Should return vaults by creator", async function () {
      const ownerVaults = await factory.getVaultsByCreator(owner.address);
      expect(ownerVaults.length).to.equal(2);
      expect(ownerVaults).to.include(vault1);
      expect(ownerVaults).to.include(vault3);

      const user1Vaults = await factory.getVaultsByCreator(user1.address);
      expect(user1Vaults.length).to.equal(1);
      expect(user1Vaults).to.include(vault2);
    });
  });

  describe("Gas Optimization", function () {
    it("Should deploy vault with reasonable gas cost", async function () {
      const tx = await factory.createVault(
        await mockToken.getAddress(),
        "Test Vault",
        "TVAULT",
        [],
        []
      );
      const receipt = await tx.wait();

      console.log("Gas used for vault creation:", receipt.gasUsed.toString());
      
      // Direct deployment uses more gas than proxy pattern (~2.6M vs ~200k)
      // This is expected trade-off for simpler architecture
      expect(receipt.gasUsed).to.be.below(3000000);
    });
  });
});
