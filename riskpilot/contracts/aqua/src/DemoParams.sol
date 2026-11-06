// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title DemoParams - addresses and curve parameters shared by the fork test and the demo chain
library DemoParams {
    // 1inch Aqua contract-addresses page: same address on all 13 Aqua chains.
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address internal constant ROUTER = 0x111111338c5091E8440b67B168bAe16a668AC0De;
    // Canonical Ethereum mainnet tokens; the fork test checks symbol and decimals on-chain.
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    // Pinned Ethereum mainnet block for the fork test and `make demo-chain`.
    // Override with AQUA_FORK_BLOCK; older blocks need an archive RPC (AQUA_FORK_RPC_URL).
    uint256 internal constant FORK_BLOCK = 26_354_292;

    // Uniswap v4 StateView (mainnet, developers.uniswap.org/contracts/v4/deployments) and the
    // fork's main ETH/USDC pool (native ETH, 0.05%, spacing 10, no hook).
    address internal constant STATE_VIEW = 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227;
    bytes32 internal constant MAIN_POOL_ID = 0x21c67e77068de97969ba93d4aab21826d33ca12bb9f565d8496e8fda8a82ca27;

    // Demo curves on the fork's own ETH price, so Aqua and the v4 hook share one price.
    // w = 1.275 gives an equivalent term of ~7 days at 55% vol ("what expiry?").
    uint256 internal constant SPOT = 2_218.55e6; // USDC per ETH: main ETH/USDC v4 pool at FORK_BLOCK
    uint256 internal constant WIDTH_BPS = 12_750; // upside 2,218.55-2,828.65; downside 1,740.04-2,218.55
    // 7 ETH at m = 0.20 is the smallest call-like curve the Balanced profile approves at this
    // spot (engine grid: 6 ETH nets $4.86 < $5.00, 7 ETH nets $5.70).
    uint256 internal constant CALL_ETH = 7 ether;
    uint256 internal constant PUT_USDC = 1_964.78e6; // q * K_eq = 1 ETH * sqrt(1,740.04 * 2,218.55)

    // Fee instructions = engine f_min (Aqua premium rule, m = 0.20, vol 55%) rounded up, in
    // SwapVM flat-fee units (1e9 = 100%). f_min = 1.2 C_eq / K_eq does not depend on spot.
    uint32 internal constant UPSIDE_FEE = 2_013_952; // 0.2014%: C_eq 4.20 / K_eq 2,505.10
    uint32 internal constant DOWNSIDE_FEE = 2_274_072; // 0.2274%: C_eq 3.72 / K_eq 1,964.78
}
