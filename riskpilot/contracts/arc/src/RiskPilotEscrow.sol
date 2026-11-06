// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title RiskPilotEscrow
/// @notice Holds a user's USDC for each approved RiskPilot decision and settles the result in
///         USDC, keyed by decisionId (keccak256 of the engine's decision_id string).
///
///         fund        user      pulls USDC in for a decision                 -> Funded
///         settle      operator  pays `payout` to the depositor; a loss moves
///                               the remainder to the reserve, a gain is
///                               topped up from it                              -> Settled
///         refund      depositor returns the full amount if not settled in 24 h -> Refunded
///         fundReserve anyone    adds USDC to the reserve that pays gains
///
///         Trust model: the operator (RiskPilot backend) settles after checking the trade's
///         result on its execution chain. That step is trusted in this demo; the refund after
///         24 h protects users if the operator disappears. Settling from a cross-chain message
///         (Circle CCTP) is the trust-minimized roadmap.
///
///         On Arc, use the USDC ERC-20 interface (0x3600…0000, 6 decimals); native USDC for gas
///         uses 18 decimals but shares the same balance.
contract RiskPilotEscrow {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Funded,
        Settled,
        Refunded
    }

    struct Deposit {
        address depositor;
        uint64 fundedAt;
        uint256 amount;
        Status status;
    }

    uint256 public constant REFUND_DELAY = 24 hours;

    IERC20 public immutable usdc;
    address public immutable operator;

    /// @notice USDC available to pay gains; losses flow into it.
    uint256 public reserve;
    mapping(bytes32 decisionId => Deposit) public deposits;

    event Funded(bytes32 indexed decisionId, address indexed depositor, uint256 amount);
    event Settled(bytes32 indexed decisionId, address indexed depositor, uint256 amount, uint256 payout, uint256 reserve);
    event Refunded(bytes32 indexed decisionId, address indexed depositor, uint256 amount);
    event ReserveFunded(address indexed from, uint256 amount, uint256 reserve);

    error ZeroAmount();
    error AlreadyFunded(bytes32 decisionId);
    error NotFunded(bytes32 decisionId);
    error NotOperator();
    error NotDepositor();
    error PayoutTooLarge(uint256 payout, uint256 max);
    error TooEarly(uint256 refundableAt);

    constructor(IERC20 _usdc, address _operator) {
        usdc = _usdc;
        operator = _operator;
    }

    function fund(bytes32 decisionId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Deposit storage d = deposits[decisionId];
        if (d.status != Status.None) revert AlreadyFunded(decisionId);
        deposits[decisionId] = Deposit(msg.sender, uint64(block.timestamp), amount, Status.Funded);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(decisionId, msg.sender, amount);
    }

    function settle(bytes32 decisionId, uint256 payout) external {
        if (msg.sender != operator) revert NotOperator();
        Deposit storage d = deposits[decisionId];
        if (d.status != Status.Funded) revert NotFunded(decisionId);
        uint256 max = d.amount + reserve;
        if (payout > max) revert PayoutTooLarge(payout, max);

        // One settlement per decision; update state before the transfer.
        d.status = Status.Settled;
        reserve = max - payout; // loss: reserve grows by amount - payout; gain: shrinks by payout - amount
        if (payout > 0) usdc.safeTransfer(d.depositor, payout);
        emit Settled(decisionId, d.depositor, d.amount, payout, reserve);
    }

    function refund(bytes32 decisionId) external {
        Deposit storage d = deposits[decisionId];
        if (d.status != Status.Funded) revert NotFunded(decisionId);
        if (msg.sender != d.depositor) revert NotDepositor();
        uint256 refundableAt = d.fundedAt + REFUND_DELAY;
        if (block.timestamp < refundableAt) revert TooEarly(refundableAt);

        d.status = Status.Refunded;
        usdc.safeTransfer(d.depositor, d.amount);
        emit Refunded(decisionId, d.depositor, d.amount);
    }

    function fundReserve(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        reserve += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit ReserveFunded(msg.sender, amount, reserve);
    }
}
