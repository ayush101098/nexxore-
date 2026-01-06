const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BaseVault", function () {
  let factory;
  let vaultImplementation;
  let vault;
  let mockToken;
  let owner;
  let user1;
  let user2;
  let strategist;
  let guardian;

  const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 18); // 1000 tokens
  const STRATEGY_ALLOCATION = ethers.parseUnits("500", 18); // 500 tokens

  beforeEach(async function () {
    [owner, user1, user2, strategist, guardian] = await ethers.getSigners();

    // Deploy mock ERC20 token (18 decimals by default)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock USDC", "USDC");
    await mockToken.waitForDeployment();

    // Mint tokens to users
    await mockToken.mint(owner.address, ethers.parseUnits("10000", 18));
    await mockToken.mint(user1.address, ethers.parseUnits("10000", 18));
    await mockToken.mint(user2.address, ethers.parseUnits("10000", 18));

    // Deploy factory
    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    factory = await VaultFactory.deploy();
    await factory.waitForDeployment();

    // Create vault through factory
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

    vault = await ethers.getContractAt("BaseVault", vaultAddress);
  });

  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await vault.name()).to.equal("Test Vault");
      expect(await vault.symbol()).to.equal("TVAULT");
      expect(await vault.asset()).to.equal(await mockToken.getAddress());
    });

    it("Should grant correct roles", async function () {
      const DEFAULT_ADMIN_ROLE = await vault.DEFAULT_ADMIN_ROLE();
      const STRATEGIST_ROLE = await vault.STRATEGIST_ROLE();
      const GUARDIAN_ROLE = await vault.GUARDIAN_ROLE();

      expect(await vault.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await vault.hasRole(STRATEGIST_ROLE, owner.address)).to.be.true;
      expect(await vault.hasRole(GUARDIAN_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero total assets", async function () {
      expect(await vault.totalAssets()).to.equal(0);
    });
  });

  describe("Deposits and Withdrawals", function () {
    beforeEach(async function () {
      await mockToken.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
    });

    it("Should deposit assets successfully", async function () {
      const shares = await vault.connect(user1).deposit.staticCall(
        DEPOSIT_AMOUNT,
        user1.address
      );

      await expect(
        vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address)
      )
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, DEPOSIT_AMOUNT, shares);

      expect(await vault.balanceOf(user1.address)).to.equal(shares);
      expect(await vault.totalAssets()).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should revert deposit when paused", async function () {
      const GUARDIAN_ROLE = await vault.GUARDIAN_ROLE();
      await vault.grantRole(GUARDIAN_ROLE, guardian.address);
      await vault.connect(guardian).pause();

      await expect(
        vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address)
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("Should withdraw assets successfully", async function () {
      // First deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      const shares = await vault.balanceOf(user1.address);
      const withdrawAmount = DEPOSIT_AMOUNT / 2n;

      await expect(
        vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address)
      ).to.emit(vault, "Withdraw");

      expect(await vault.balanceOf(user1.address)).to.be.below(shares);
    });

    it("Should mint shares successfully", async function () {
      const sharesToMint = ethers.parseUnits("500", 18);
      
      await vault.connect(user1).mint(sharesToMint, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(sharesToMint);
    });

    it("Should redeem shares successfully", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      const shares = await vault.balanceOf(user1.address);
      const sharesToRedeem = shares / 2n;

      const balanceBefore = await mockToken.balanceOf(user1.address);
      
      await vault.connect(user1).redeem(sharesToRedeem, user1.address, user1.address);

      const balanceAfter = await mockToken.balanceOf(user1.address);
      expect(balanceAfter).to.be.above(balanceBefore);
    });

    it("Should calculate correct share conversion", async function () {
      // First deposit creates 1:1 ratio
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      const shares = await vault.convertToShares(DEPOSIT_AMOUNT);
      const assets = await vault.convertToAssets(shares);
      
      expect(assets).to.be.closeTo(DEPOSIT_AMOUNT, 10); // Allow small rounding
    });
  });

  describe("Strategy Management", function () {
    let mockStrategy;

    beforeEach(async function () {
      // Deploy mock strategy (just an address for testing)
      mockStrategy = user2.address;

      const STRATEGIST_ROLE = await vault.STRATEGIST_ROLE();
      await vault.grantRole(STRATEGIST_ROLE, strategist.address);
    });

    it("Should add strategy successfully", async function () {
      const weight = 5000; // 50%

      await expect(vault.connect(strategist).addStrategy(mockStrategy, weight))
        .to.emit(vault, "StrategyAdded")
        .withArgs(mockStrategy, weight);

      expect(await vault.strategyWeights(mockStrategy)).to.equal(weight);
      expect(await vault.totalWeight()).to.equal(weight);
    });

    it("Should revert when adding strategy with excessive weight", async function () {
      const weight = 6000; // 60% > MAX_STRATEGY_WEIGHT (50%)

      await expect(
        vault.connect(strategist).addStrategy(mockStrategy, weight)
      ).to.be.revertedWithCustomError(vault, "InvalidWeight");
    });

    it("Should revert when adding duplicate strategy", async function () {
      await vault.connect(strategist).addStrategy(mockStrategy, 5000);

      await expect(
        vault.connect(strategist).addStrategy(mockStrategy, 3000)
      ).to.be.revertedWithCustomError(vault, "StrategyAlreadyExists");
    });

    it("Should update strategy weight", async function () {
      await vault.connect(strategist).addStrategy(mockStrategy, 3000);

      const newWeight = 4000;
      await expect(
        vault.connect(strategist).updateStrategyWeight(mockStrategy, newWeight)
      )
        .to.emit(vault, "StrategyWeightUpdated")
        .withArgs(mockStrategy, 3000, newWeight);

      expect(await vault.strategyWeights(mockStrategy)).to.equal(newWeight);
    });

    it("Should remove strategy with zero allocation", async function () {
      await vault.connect(strategist).addStrategy(mockStrategy, 3000);

      await expect(vault.connect(strategist).removeStrategy(mockStrategy))
        .to.emit(vault, "StrategyRemoved")
        .withArgs(mockStrategy);

      expect(await vault.strategyWeights(mockStrategy)).to.equal(0);
    });

    it("Should revert when removing strategy with active allocation", async function () {
      await vault.connect(strategist).addStrategy(mockStrategy, 5000);
      
      // Deposit funds
      await mockToken.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      // Allocate to strategy
      await vault.connect(strategist).allocateToStrategy(mockStrategy, STRATEGY_ALLOCATION);

      await expect(
        vault.connect(strategist).removeStrategy(mockStrategy)
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });

    it("Should revert when non-strategist adds strategy", async function () {
      await expect(
        vault.connect(user1).addStrategy(mockStrategy, 5000)
      ).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    });

    it("Should return all strategies", async function () {
      const strategy1 = user2.address;
      const strategy2 = guardian.address;

      await vault.connect(strategist).addStrategy(strategy1, 3000);
      await vault.connect(strategist).addStrategy(strategy2, 2000);

      const strategies = await vault.getStrategies();
      expect(strategies.length).to.equal(2);
      expect(strategies).to.include(strategy1);
      expect(strategies).to.include(strategy2);
    });
  });

  describe("Capital Allocation", function () {
    let mockStrategy;
    let strategyBalanceBefore;

    beforeEach(async function () {
      // Create a fresh address for the strategy (not an existing user)
      mockStrategy = ethers.Wallet.createRandom().address;

      const STRATEGIST_ROLE = await vault.STRATEGIST_ROLE();
      await vault.grantRole(STRATEGIST_ROLE, strategist.address);

      // Add strategy
      await vault.connect(strategist).addStrategy(mockStrategy, 5000);

      // Deposit funds
      await mockToken.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      // Record balance before allocation
      strategyBalanceBefore = await mockToken.balanceOf(mockStrategy);
    });

    it("Should allocate capital to strategy", async function () {
      await expect(
        vault.connect(strategist).allocateToStrategy(mockStrategy, STRATEGY_ALLOCATION)
      )
        .to.emit(vault, "CapitalAllocated")
        .withArgs(mockStrategy, STRATEGY_ALLOCATION);

      expect(await vault.strategyAllocations(mockStrategy)).to.equal(STRATEGY_ALLOCATION);
      // Check that the strategy received the allocated amount
      expect(await mockToken.balanceOf(mockStrategy)).to.equal(strategyBalanceBefore + STRATEGY_ALLOCATION);
    });

    it("Should revert allocation with insufficient balance", async function () {
      const excessiveAmount = DEPOSIT_AMOUNT + 1n;

      await expect(
        vault.connect(strategist).allocateToStrategy(mockStrategy, excessiveAmount)
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });

    it("Should track total assets including allocations", async function () {
      await vault.connect(strategist).allocateToStrategy(mockStrategy, STRATEGY_ALLOCATION);

      const totalAssets = await vault.totalAssets();
      expect(totalAssets).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should return correct idle balance", async function () {
      await vault.connect(strategist).allocateToStrategy(mockStrategy, STRATEGY_ALLOCATION);

      const idle = await vault.idleBalance();
      expect(idle).to.equal(DEPOSIT_AMOUNT - STRATEGY_ALLOCATION);
    });

    it("Should get strategy info", async function () {
      await vault.connect(strategist).allocateToStrategy(mockStrategy, STRATEGY_ALLOCATION);

      const info = await vault.getStrategyInfo(mockStrategy);
      expect(info.weight).to.equal(5000);
      expect(info.allocation).to.equal(STRATEGY_ALLOCATION);
    });
  });

  describe("Rebalancing", function () {
    let strategy1, strategy2;

    beforeEach(async function () {
      // Use fresh addresses for strategies
      strategy1 = ethers.Wallet.createRandom().address;
      strategy2 = ethers.Wallet.createRandom().address;

      const STRATEGIST_ROLE = await vault.STRATEGIST_ROLE();
      await vault.grantRole(STRATEGIST_ROLE, strategist.address);

      // Add strategies with weights (50/30 split, each within MAX_STRATEGY_WEIGHT of 50%)
      await vault.connect(strategist).addStrategy(strategy1, 5000); // 50%
      await vault.connect(strategist).addStrategy(strategy2, 3000); // 30%

      // Deposit funds
      await mockToken.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
    });

    it("Should rebalance capital across strategies", async function () {
      // Advance time to allow rebalancing (MIN_REBALANCE_INTERVAL = 1 hour)
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine");

      await expect(vault.connect(strategist).rebalance())
        .to.emit(vault, "Rebalanced");

      const allocation1 = await vault.strategyAllocations(strategy1);
      const allocation2 = await vault.strategyAllocations(strategy2);

      // Check allocations match weights (50/30 split)
      const expectedAllocation1 = (DEPOSIT_AMOUNT * 5000n) / 10000n;
      const expectedAllocation2 = (DEPOSIT_AMOUNT * 3000n) / 10000n;

      expect(allocation1).to.be.closeTo(expectedAllocation1, 10);
      expect(allocation2).to.be.closeTo(expectedAllocation2, 10);
    });

    it("Should revert rebalance if called too soon", async function () {
      // Advance time to allow first rebalance
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine");

      await vault.connect(strategist).rebalance();

      // Try to rebalance again immediately (should fail)
      await expect(
        vault.connect(strategist).rebalance()
      ).to.be.revertedWithCustomError(vault, "RebalanceTooSoon");
    });

    it("Should allow rebalance after interval", async function () {
      // Advance time to allow first rebalance
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine");

      await vault.connect(strategist).rebalance();

      // Advance time by MIN_REBALANCE_INTERVAL (1 hour) again
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine");

      await expect(vault.connect(strategist).rebalance()).to.not.be.reverted;
    });
  });

  describe("Fee Management", function () {
    beforeEach(async function () {
      // Owner has DEFAULT_ADMIN_ROLE
    });

    it("Should set performance fee", async function () {
      const newFee = 200; // 2%

      await expect(vault.setPerformanceFee(newFee))
        .to.emit(vault, "PerformanceFeeUpdated")
        .withArgs(0, newFee);

      expect(await vault.performanceFee()).to.equal(newFee);
    });

    it("Should revert fee above maximum", async function () {
      const excessiveFee = 1100; // 11% > MAX (10%)

      await expect(
        vault.setPerformanceFee(excessiveFee)
      ).to.be.revertedWithCustomError(vault, "InvalidFee");
    });

    it("Should set fee recipient", async function () {
      await expect(vault.setFeeRecipient(user1.address))
        .to.emit(vault, "FeeRecipientUpdated")
        .withArgs(owner.address, user1.address);

      expect(await vault.feeRecipient()).to.equal(user1.address);
    });

    it("Should revert zero address fee recipient", async function () {
      await expect(
        vault.setFeeRecipient(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
  });

  describe("Emergency Functions", function () {
    beforeEach(async function () {
      const GUARDIAN_ROLE = await vault.GUARDIAN_ROLE();
      await vault.grantRole(GUARDIAN_ROLE, guardian.address);
    });

    it("Should pause vault", async function () {
      await vault.connect(guardian).pause();
      expect(await vault.paused()).to.be.true;
    });

    it("Should unpause vault", async function () {
      await vault.connect(guardian).pause();
      await vault.connect(guardian).unpause();
      expect(await vault.paused()).to.be.false;
    });

    it("Should emergency withdraw from strategy", async function () {
      const mockStrategy = user2.address;
      const STRATEGIST_ROLE = await vault.STRATEGIST_ROLE();
      await vault.grantRole(STRATEGIST_ROLE, strategist.address);

      await vault.connect(strategist).addStrategy(mockStrategy, 5000);
      
      await mockToken.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      await vault.connect(strategist).allocateToStrategy(mockStrategy, STRATEGY_ALLOCATION);

      await expect(vault.connect(guardian).emergencyWithdraw(mockStrategy))
        .to.emit(vault, "EmergencyWithdraw")
        .withArgs(mockStrategy, STRATEGY_ALLOCATION);

      expect(await vault.strategyAllocations(mockStrategy)).to.equal(0);
    });

    it("Should revert pause when not guardian", async function () {
      await expect(
        vault.connect(user1).pause()
      ).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Gas Optimization", function () {
    beforeEach(async function () {
      await mockToken.connect(user1).approve(await vault.getAddress(), DEPOSIT_AMOUNT);
    });

    it("Should deposit with reasonable gas cost", async function () {
      const tx = await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      const receipt = await tx.wait();

      console.log("Gas used for deposit:", receipt.gasUsed.toString());
      
      // Target: < 150k gas for deposits
      expect(receipt.gasUsed).to.be.below(150000);
    });

    it("Should withdraw with reasonable gas cost", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      const tx = await vault.connect(user1).withdraw(
        DEPOSIT_AMOUNT / 2n,
        user1.address,
        user1.address
      );
      const receipt = await tx.wait();

      console.log("Gas used for withdraw:", receipt.gasUsed.toString());
      expect(receipt.gasUsed).to.be.below(150000);
    });
  });
});
