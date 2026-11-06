// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

/// @title AquaCollateral - per-token collateral invariant for Aqua curves
/// @notice Aqua balances are allowances: shipping a strategy locks nothing, and
///         a fill pulls from the maker's wallet with transferFrom. So nothing
///         on-chain stops a maker from shipping curves that together promise
///         more than the wallet holds. This check runs before shipping:
///         for each token, the sum of every curve's maximum outflow of that
///         token must not exceed what Aqua can actually pull from the wallet.
library AquaCollateral {
    /// @notice One curve's Aqua allocation. A curve can pay out at most what it was shipped with.
    struct Shipment {
        address[] tokens;
        uint256[] amounts;
    }

    error CollateralExceeded(address token, uint256 required, uint256 available);
    error ShipmentLengthMismatch();

    /// @notice Sum of every shipment's maximum outflow of `token`.
    function maxOutflow(Shipment[] memory plan, address token) internal pure returns (uint256 total) {
        for (uint256 i = 0; i < plan.length; i++) {
            require(plan[i].tokens.length == plan[i].amounts.length, ShipmentLengthMismatch());
            for (uint256 j = 0; j < plan[i].tokens.length; j++) {
                if (plan[i].tokens[j] == token) {
                    total += plan[i].amounts[j];
                }
            }
        }
    }

    /// @notice What Aqua can pull from `maker` for `token`: the lower of balance and allowance.
    function available(address maker, address aqua, address token) internal view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(maker);
        uint256 allowance = IERC20(token).allowance(maker, aqua);
        return balance < allowance ? balance : allowance;
    }

    /// @notice Revert with CollateralExceeded unless every token in `plan` is covered.
    /// @param plan The curves about to ship plus every curve already live for this maker.
    function check(Shipment[] memory plan, address maker, address aqua) internal view {
        for (uint256 i = 0; i < plan.length; i++) {
            for (uint256 j = 0; j < plan[i].tokens.length; j++) {
                address token = plan[i].tokens[j];
                uint256 required = maxOutflow(plan, token);
                uint256 have = available(maker, aqua, token);
                require(required <= have, CollateralExceeded(token, required, have));
            }
        }
    }

    /// @notice A live strategy's current Aqua balances, to include in `plan`.
    function live(IAqua aqua, address maker, address app, bytes32 strategyHash, address[] memory tokens)
        internal
        view
        returns (Shipment memory s)
    {
        s.tokens = tokens;
        s.amounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            (uint248 balance,) = aqua.rawBalances(maker, app, strategyHash, tokens[i]);
            s.amounts[i] = balance;
        }
    }
}
