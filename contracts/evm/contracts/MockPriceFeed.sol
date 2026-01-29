// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockPriceFeed
 * @notice Mock Chainlink price feed for testing
 */
contract MockPriceFeed {
    int256 private _price;
    uint8 private _decimals;
    string private _description;
    uint256 private _updatedAt;

    constructor(int256 initialPrice, uint8 decimals_, string memory description_) {
        _price = initialPrice;
        _decimals = decimals_;
        _description = description_;
        _updatedAt = block.timestamp;
    }

    function setPrice(int256 newPrice) external {
        _price = newPrice;
        _updatedAt = block.timestamp;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, _price, _updatedAt, _updatedAt, 1);
    }

    function getRoundData(uint80)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, _price, _updatedAt, _updatedAt, 1);
    }
}
