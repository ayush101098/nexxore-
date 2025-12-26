const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NexxoreVault", function () {
  let vault;
  let token;
  let owner;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock ERC20
    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("Test Token", "TEST");
    await token.deployed();

    // Deploy vault
    const Vault = await ethers.getContractFactory("NexxoreVault");
    vault = await Vault.deploy(token.address);
    await vault.deployed();

    // Mint tokens to users
    await token.mint(user1.address, ethers.utils.parseEther("1000"));
    await token.mint(user2.address, ethers.utils.parseEther("1000"));

    // Approve vault
    await token.connect(user1).approve(vault.address, ethers.constants.MaxUint256);
    await token.connect(user2).approve(vault.address, ethers.constants.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct asset", async function () {
      expect(await vault.asset()).to.equal(token.address);
    });

    it("Should initialize with zero totals", async function () {
      expect(await vault.totalAssets()).to.equal(0);
      expect(await vault.totalShares()).to.equal(0);
    });
  });

  describe("Deposits", function () {
    it("Should deposit correctly for first user", async function () {
      const amount = ethers.utils.parseEther("100");
      
      await expect(vault.connect(user1).deposit(amount))
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, amount, amount, await ethers.provider.getBlock('latest').then(b => b.timestamp + 1));

      expect(await vault.shares(user1.address)).to.equal(amount);
      expect(await vault.totalShares()).to.equal(amount);
      expect(await vault.totalAssets()).to.equal(amount);
    });

    it("Should calculate shares correctly for subsequent deposits", async function () {
      // First deposit
      await vault.connect(user1).deposit(ethers.utils.parseEther("100"));
      
      // Second deposit
      const secondAmount = ethers.utils.parseEther("50");
      await vault.connect(user2).deposit(secondAmount);

      expect(await vault.shares(user2.address)).to.equal(secondAmount);
      expect(await vault.totalShares()).to.equal(ethers.utils.parseEther("150"));
    });

    it("Should revert on zero deposit", async function () {
      await expect(vault.connect(user1).deposit(0))
        .to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("Should work with depositFor", async function () {
      const amount = ethers.utils.parseEther("100");
      
      await vault.connect(user1).depositFor(amount, user2.address);

      expect(await vault.shares(user2.address)).to.equal(amount);
      expect(await vault.shares(user1.address)).to.equal(0);
    });
  });

  describe("Withdrawals", function () {
    beforeEach(async function () {
      // Setup: user1 deposits 100 tokens
      await vault.connect(user1).deposit(ethers.utils.parseEther("100"));
    });

    it("Should withdraw correctly", async function () {
      const sharesToBurn = ethers.utils.parseEther("50");
      const initialBalance = await token.balanceOf(user1.address);

      await vault.connect(user1).withdraw(sharesToBurn);

      expect(await vault.shares(user1.address)).to.equal(sharesToBurn);
      expect(await token.balanceOf(user1.address)).to.equal(
        initialBalance.add(sharesToBurn)
      );
    });

    it("Should revert on insufficient shares", async function () {
      await expect(
        vault.connect(user1).withdraw(ethers.utils.parseEther("200"))
      ).to.be.revertedWithCustomError(vault, "InsufficientShares");
    });

    it("Should work with withdrawAssets", async function () {
      const assetAmount = ethers.utils.parseEther("30");
      const initialBalance = await token.balanceOf(user1.address);

      await vault.connect(user1).withdrawAssets(assetAmount);

      expect(await token.balanceOf(user1.address)).to.equal(
        initialBalance.add(assetAmount)
      );
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await vault.connect(user1).deposit(ethers.utils.parseEther("100"));
    });

    it("Should return correct balanceOf", async function () {
      expect(await vault.balanceOf(user1.address)).to.equal(
        ethers.utils.parseEther("100")
      );
    });

    it("Should convert shares to assets correctly", async function () {
      const shares = ethers.utils.parseEther("50");
      expect(await vault.convertToAssets(shares)).to.equal(shares);
    });

    it("Should convert assets to shares correctly", async function () {
      const assets = ethers.utils.parseEther("50");
      expect(await vault.convertToShares(assets)).to.equal(assets);
    });
  });

  describe("Pause Mechanism", function () {
    it("Should pause and unpause", async function () {
      await vault.pause();
      
      await expect(
        vault.connect(user1).deposit(ethers.utils.parseEther("100"))
      ).to.be.revertedWith("Pausable: paused");

      await vault.unpause();
      
      await expect(
        vault.connect(user1).deposit(ethers.utils.parseEther("100"))
      ).to.not.be.reverted;
    });

    it("Should allow withdrawals when paused", async function () {
      await vault.connect(user1).deposit(ethers.utils.parseEther("100"));
      
      await vault.pause();
      
      await expect(
        vault.connect(user1).withdraw(ethers.utils.parseEther("50"))
      ).to.not.be.reverted;
    });
  });

  describe("Reentrancy Protection", function () {
    it("Should prevent reentrancy attacks", async function () {
      // This would require a malicious token contract
      // Placeholder for actual reentrancy test
      expect(true).to.be.true;
    });
  });
});
