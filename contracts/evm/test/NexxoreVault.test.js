const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NexxoreVault", function () {
  let vault;
  let token;
  let owner;
  let user1;
  let user2;
  let tokenAddress;
  let vaultAddress;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock ERC20
    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("Test USDT", "USDT");
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();

    // Deploy vault
    const Vault = await ethers.getContractFactory("NexxoreVault");
    vault = await Vault.deploy();
    await vault.waitForDeployment();
    vaultAddress = await vault.getAddress();

    // Mint tokens to users
    await token.mint(user1.address, ethers.parseUnits("1000", 6));
    await token.mint(user2.address, ethers.parseUnits("1000", 6));

    // Approve vault
    await token.connect(user1).approve(vaultAddress, ethers.MaxUint256);
    await token.connect(user2).approve(vaultAddress, ethers.MaxUint256);
  });

  describe("Token Deposits", function () {
    it("Should deposit tokens correctly", async function () {
      const amount = ethers.parseUnits("100", 6);
      
      await expect(vault.connect(user1).depositToken(tokenAddress, amount))
        .to.emit(vault, "TokenDeposit");

      const userBalance = await vault.getUserBalance(user1.address, tokenAddress);
      expect(userBalance).to.equal(amount);

      const totalDeposits = await vault.getTotalDeposits(tokenAddress);
      expect(totalDeposits).to.equal(amount);
    });

    it("Should handle multiple deposits", async function () {
      const amount1 = ethers.parseUnits("50", 6);
      const amount2 = ethers.parseUnits("30", 6);

      await vault.connect(user1).depositToken(tokenAddress, amount1);
      await vault.connect(user1).depositToken(tokenAddress, amount2);

      const userBalance = await vault.getUserBalance(user1.address, tokenAddress);
      expect(userBalance).to.equal(amount1 + amount2);
    });

    it("Should revert on zero amount", async function () {
      await expect(
        vault.connect(user1).depositToken(tokenAddress, 0)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });
  });

  describe("ETH Deposits", function () {
    it("Should deposit ETH correctly", async function () {
      const amount = ethers.parseEther("1");
      
      await expect(vault.connect(user1).depositETH({ value: amount }))
        .to.emit(vault, "ETHDeposit");

      const userBalance = await vault.getUserBalance(user1.address, ethers.ZeroAddress);
      expect(userBalance).to.equal(amount);
    });

    it("Should receive ETH via receive function", async function () {
      const amount = ethers.parseEther("0.5");
      
      await user1.sendTransaction({
        to: vaultAddress,
        value: amount
      });

      const userBalance = await vault.getUserBalance(user1.address, ethers.ZeroAddress);
      expect(userBalance).to.equal(amount);
    });

    it("Should revert on zero ETH", async function () {
      await expect(
        vault.connect(user1).depositETH({ value: 0 })
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });
  });

  describe("View Functions", function () {
    it("Should return correct user balances", async function () {
      const tokenAmount = ethers.parseUnits("100", 6);
      const ethAmount = ethers.parseEther("1");

      await vault.connect(user1).depositToken(tokenAddress, tokenAmount);
      await vault.connect(user1).depositETH({ value: ethAmount });

      expect(await vault.getUserBalance(user1.address, tokenAddress)).to.equal(tokenAmount);
      expect(await vault.getUserBalance(user1.address, ethers.ZeroAddress)).to.equal(ethAmount);
    });

    it("Should return correct total deposits", async function () {
      const amount1 = ethers.parseUnits("100", 6);
      const amount2 = ethers.parseUnits("50", 6);

      await vault.connect(user1).depositToken(tokenAddress, amount1);
      await vault.connect(user2).depositToken(tokenAddress, amount2);

      const total = await vault.getTotalDeposits(tokenAddress);
      expect(total).to.equal(amount1 + amount2);
    });

    it("Should return correct vault balance", async function () {
      const amount = ethers.parseUnits("100", 6);
      await vault.connect(user1).depositToken(tokenAddress, amount);

      const vaultBalance = await vault.getVaultBalance(tokenAddress);
      expect(vaultBalance).to.equal(amount);
    });
  });
});
