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

    // Demo curves: w = 1.275 gives an equivalent term of ~7 days at 55% vol, so the
    // covered-call framing has a real answer to "what expiry?".
    uint256 internal constant SPOT = 3400e6; // USDC per ETH
    uint256 internal constant WIDTH_BPS = 12_750; // upside 3,400-4,335; downside 2,666.67-3,400
    // 5 ETH at m = 0.20 is the smallest call-like curve the Balanced profile approves (engine grid).
    uint256 internal constant CALL_ETH = 5 ether;
    uint256 internal constant PUT_USDC = 3_011.09e6; // q * K_eq = 1 ETH * sqrt(2666.67 * 3400)

    // Fee instructions = engine f_min (Aqua premium rule, m = 0.20, vol 55%) rounded up,
    // in SwapVM flat-fee units (1e9 = 100%). From POST /aqua/price premium_floor.fee_instruction_min.
    uint32 internal constant UPSIDE_FEE = 2_013_952; // 0.2014%: C_eq 6.44 / K_eq 3,839.14
    uint32 internal constant DOWNSIDE_FEE = 2_274_072; // 0.2274%: C_eq 5.71 / K_eq 3,011.09
}
