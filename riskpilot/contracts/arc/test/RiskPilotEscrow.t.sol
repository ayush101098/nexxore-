// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {RiskPilotEscrow} from "../src/RiskPilotEscrow.sol";

/// @dev Stand-in for Arc's USDC ERC-20 interface (0x3600…0000), which reports 6 decimals.
contract MockUSDC is ERC20("USD Coin", "USDC") {
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract RiskPilotEscrowTest is Test {
    MockUSDC usdc;
    RiskPilotEscrow escrow;
    address operator = makeAddr("operator");
    address user = makeAddr("user");
    address backer = makeAddr("backer");
    bytes32 constant DEC = keccak256("dec_9587df300c5929b8");

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new RiskPilotEscrow(usdc, operator);
        usdc.mint(user, 10_000e6);
        usdc.mint(backer, 10_000e6);
        vm.prank(user);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(backer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _fund(uint256 amount) internal {
        vm.prank(user);
        escrow.fund(DEC, amount);
    }

    // ── the five PRD 5 tests ──────────────────────────────────────────────

    /// Fund, then settle at a loss: the user receives the payout, the remainder goes to the reserve.
    function test_SettleAtALossMovesRemainderToReserve() public {
        _fund(1_000e6);
        vm.expectEmit(address(escrow));
        emit RiskPilotEscrow.Settled(DEC, user, 1_000e6, 940e6, 60e6);
        vm.prank(operator);
        escrow.settle(DEC, 940e6);

        assertEq(usdc.balanceOf(user), 9_940e6, "user got the payout");
        assertEq(escrow.reserve(), 60e6, "loss stays in the reserve");
        assertEq(usdc.balanceOf(address(escrow)), 60e6);
        (,,, RiskPilotEscrow.Status status) = escrow.deposits(DEC);
        assertEq(uint8(status), uint8(RiskPilotEscrow.Status.Settled));
    }

    /// Fund, then settle at a gain: the reserve tops up the payout.
    function test_SettleAtAGainDrawsOnReserve() public {
        vm.prank(backer);
        escrow.fundReserve(500e6);
        _fund(1_000e6);
        vm.prank(operator);
        escrow.settle(DEC, 1_120e6);

        assertEq(usdc.balanceOf(user), 10_120e6, "user got principal plus the gain");
        assertEq(escrow.reserve(), 380e6, "the gain came out of the reserve");
        assertEq(usdc.balanceOf(address(escrow)), 380e6);
    }

    /// A second settle reverts; a non-operator settle reverts.
    function test_SettleOnceAndOnlyByOperator() public {
        _fund(1_000e6);
        vm.prank(user);
        vm.expectRevert(RiskPilotEscrow.NotOperator.selector);
        escrow.settle(DEC, 1_000e6);

        vm.prank(operator);
        escrow.settle(DEC, 1_000e6);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(RiskPilotEscrow.NotFunded.selector, DEC));
        escrow.settle(DEC, 1_000e6);
    }

    /// A payout above amount + reserve reverts.
    function test_PayoutAboveAmountPlusReserveReverts() public {
        vm.prank(backer);
        escrow.fundReserve(100e6);
        _fund(1_000e6);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(RiskPilotEscrow.PayoutTooLarge.selector, 1_100e6 + 1, 1_100e6));
        escrow.settle(DEC, 1_100e6 + 1);

        vm.prank(operator);
        escrow.settle(DEC, 1_100e6); // exactly amount + reserve is fine
        assertEq(escrow.reserve(), 0);
    }

    /// Refund works after 24 h, and not before.
    function test_RefundOnlyAfter24Hours() public {
        _fund(1_000e6);
        uint256 refundableAt = block.timestamp + 24 hours;
        vm.warp(refundableAt - 1);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(RiskPilotEscrow.TooEarly.selector, refundableAt));
        escrow.refund(DEC);

        vm.warp(refundableAt);
        vm.prank(backer);
        vm.expectRevert(RiskPilotEscrow.NotDepositor.selector);
        escrow.refund(DEC);

        vm.prank(user);
        escrow.refund(DEC);
        assertEq(usdc.balanceOf(user), 10_000e6, "full amount back");
        // A refunded decision can no longer be settled.
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(RiskPilotEscrow.NotFunded.selector, DEC));
        escrow.settle(DEC, 1_000e6);
    }

    // ── guards ────────────────────────────────────────────────────────────

    function test_ADecisionFundsOnce() public {
        _fund(1_000e6);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(RiskPilotEscrow.AlreadyFunded.selector, DEC));
        escrow.fund(DEC, 1e6);
    }

    function test_ZeroAmountsRevert() public {
        vm.prank(user);
        vm.expectRevert(RiskPilotEscrow.ZeroAmount.selector);
        escrow.fund(DEC, 0);
        vm.prank(backer);
        vm.expectRevert(RiskPilotEscrow.ZeroAmount.selector);
        escrow.fundReserve(0);
    }
}
