// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../MockERC20.sol";

contract PerpsMargin {
    struct Position {
        int256 size;
        uint256 entryPrice;
        uint256 margin;
        uint256 leverage;
        bool open;
    }

    MockERC20 public collateral;
    address public owner;

    mapping(address => uint256) public marginBalances;
    mapping(address => mapping(bytes32 => Position)) public positions;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event PositionOpened(address indexed user, bytes32 indexed market, int256 size, uint256 entryPrice, uint256 margin, uint256 leverage);
    event PositionClosed(address indexed user, bytes32 indexed market, int256 size, uint256 exitPrice);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address collateralToken) {
        collateral = MockERC20(collateralToken);
        owner = msg.sender;
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "amount=0");
        collateral.transferFrom(msg.sender, address(this), amount);
        marginBalances[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "amount=0");
        require(marginBalances[msg.sender] >= amount, "insufficient");
        marginBalances[msg.sender] -= amount;
        collateral.transfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    function openPosition(bytes32 market, int256 size, uint256 entryPrice, uint256 margin, uint256 leverage) external {
        require(marginBalances[msg.sender] >= margin, "insufficient margin");
        marginBalances[msg.sender] -= margin;
        positions[msg.sender][market] = Position({
            size: size,
            entryPrice: entryPrice,
            margin: margin,
            leverage: leverage,
            open: true
        });
        emit PositionOpened(msg.sender, market, size, entryPrice, margin, leverage);
    }

    function closePosition(bytes32 market, uint256 exitPrice) external {
        Position storage pos = positions[msg.sender][market];
        require(pos.open, "no position");
        pos.open = false;
        marginBalances[msg.sender] += pos.margin;
        emit PositionClosed(msg.sender, market, pos.size, exitPrice);
    }

    function adminWithdraw(address to, uint256 amount) external onlyOwner {
        collateral.transfer(to, amount);
    }
}
