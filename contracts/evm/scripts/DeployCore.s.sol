// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/NUSD.sol";
import "../contracts/CollateralManager.sol";
import "../contracts/StrategyRouter.sol";
import "../contracts/BaseVault.sol";
import "../contracts/VaultFactory.sol";

/**
 * @title DeployCore
 * @notice Deploys all core Nexxore contracts
 * 
 * Deployment order:
 * 1. nUSD Token
 * 2. CollateralManager
 * 3. StrategyRouter
 * 4. VaultFactory
 * 5. Configure relationships
 */
contract DeployCore is Script {
    
    // Deployed addresses
    NUSD public nusd;
    CollateralManager public collateralManager;
    StrategyRouter public strategyRouter;
    VaultFactory public vaultFactory;
    
    // Chainlink ETH/USD price feed (Ethereum mainnet)
    address constant ETH_USD_FEED = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying from:", deployer);
        console.log("Balance:", deployer.balance);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // 1. Deploy nUSD Token
        nusd = new NUSD();
        console.log("nUSD deployed at:", address(nusd));
        
        // 2. Deploy CollateralManager
        collateralManager = new CollateralManager(address(nusd));
        console.log("CollateralManager deployed at:", address(collateralManager));
        
        // 3. Set CollateralManager as nUSD minter
        nusd.setCollateralManager(address(collateralManager));
        console.log("CollateralManager set as nUSD minter");
        
        // 4. Deploy StrategyRouter
        strategyRouter = new StrategyRouter(address(collateralManager));
        console.log("StrategyRouter deployed at:", address(strategyRouter));
        
        // 5. Set StrategyRouter in CollateralManager
        collateralManager.setStrategyRouter(address(strategyRouter));
        console.log("StrategyRouter set in CollateralManager");
        
        // 6. Add ETH as collateral with Chainlink price feed
        collateralManager.addCollateral(address(0), ETH_USD_FEED);
        console.log("ETH added as collateral");
        
        // 7. Deploy VaultFactory
        // Need to deploy BaseVault implementation first
        address[] memory emptyStrategies = new address[](0);
        uint256[] memory emptyWeights = new uint256[](0);
        
        // Deploy a mock USDC for vault testing (in production, use real USDC)
        MockERC20 mockUSDC = new MockERC20("Mock USDC", "USDC", 6);
        console.log("Mock USDC deployed at:", address(mockUSDC));
        
        // Deploy vault implementation
        BaseVault vaultImpl = new BaseVault(
            IERC20(address(mockUSDC)),
            "Nexxore Vault Implementation",
            "nvIMPL",
            deployer,
            emptyStrategies,
            emptyWeights
        );
        console.log("Vault Implementation deployed at:", address(vaultImpl));
        
        // Deploy VaultFactory
        vaultFactory = new VaultFactory(address(vaultImpl));
        console.log("VaultFactory deployed at:", address(vaultFactory));
        
        vm.stopBroadcast();
        
        // Log all addresses
        console.log("\n=== Deployment Summary ===");
        console.log("nUSD:", address(nusd));
        console.log("CollateralManager:", address(collateralManager));
        console.log("StrategyRouter:", address(strategyRouter));
        console.log("VaultFactory:", address(vaultFactory));
        console.log("Mock USDC:", address(mockUSDC));
    }
}

/**
 * @title MockERC20
 * @notice Simple ERC20 for testing
 */
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
