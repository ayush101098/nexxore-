// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { Controls } from "@1inch/swap-vm/src/instructions/Controls.sol";
import { Fee, FeeArgsBuilder } from "@1inch/swap-vm/src/instructions/Fee.sol";
import { XYCConcentrate, XYCConcentrateArgsBuilder } from "@1inch/swap-vm/src/instructions/XYCConcentrate.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";
import { Program, ProgramBuilder } from "@1inch/swap-vm/test/utils/ProgramBuilder.sol";

/// @title AquaCurves - options-like payoffs from SwapVM swap curves
/// @notice Builds two one-sided XYCConcentrate curves for one maker wallet:
///   upside   [spot, spot * w], funded with ETH only: sells ETH for USDC as the
///            price rises through the range (covered-call-like).
///   downside [spot / w, spot], funded with USDC only: buys ETH with USDC as the
///            price falls through the range (cash-secured-put-like).
///   XYCConcentrate derives the curve's price from its real balances, so a
///   curve holding one token sits at the edge of its range and only trades in
///   one direction. A flat Fee on each curve is the maker's premium.
///   These are not option contracts.
/// @dev Opcode bytes come from swap-vm v1.0.2's own ProgramBuilder, which looks
///      each instruction up in the AquaOpcodes table the deployed router uses.
abstract contract AquaCurves is AquaOpcodes {
    using ProgramBuilder for Program;

    struct Range {
        uint256 lowUsdc; // lower bound, USDC (6 dp) per ETH
        uint256 highUsdc; // upper bound, USDC (6 dp) per ETH
    }

    struct Curve {
        ISwapVM.Order order;
        address[] tokens;
        uint256[] amounts;
        Range range;
    }

    address public immutable WETH;
    address public immutable USDC;

    error RangeInvalid(uint256 lowUsdc, uint256 highUsdc);
    error WidthInvalid(uint256 widthBps);

    constructor(address aqua, address weth, address usdc) AquaOpcodes(aqua) {
        WETH = weth;
        USDC = usdc;
    }

    /// @notice sqrt(P) in 1e18 fixed point for XYCConcentrate, where P = tokenGt / tokenLt in
    ///         raw units, for an ETH price of `usdcPerEth` (USDC, 6 dp, per ETH).
    function sqrtPriceAt(uint256 usdcPerEth) public view returns (uint256) {
        // ETH is Gt: P = wei per USDC unit = 1e18 / usdcPerEth -> sqrt(P * 1e36) = sqrt(1e54 / usdcPerEth)
        // ETH is Lt: P = USDC units per wei = usdcPerEth / 1e18 -> sqrt(P * 1e36) = sqrt(usdcPerEth * 1e18)
        return WETH > USDC ? Math.sqrt(1e54 / usdcPerEth) : Math.sqrt(usdcPerEth * 1e18);
    }

    /// @notice Concentrate bounds (sqrtPriceMin, sqrtPriceMax) for a USD range. A rising ETH
    ///         price lowers P when ETH is Gt, so the bounds swap ends.
    function concentrateBounds(Range memory r) public view returns (uint256 sqrtMin, uint256 sqrtMax) {
        require(0 < r.lowUsdc && r.lowUsdc < r.highUsdc, RangeInvalid(r.lowUsdc, r.highUsdc));
        (uint256 a, uint256 b) = (sqrtPriceAt(r.lowUsdc), sqrtPriceAt(r.highUsdc));
        (sqrtMin, sqrtMax) = a < b ? (a, b) : (b, a);
    }

    /// @notice Equivalent strike sqrt(low * high), USDC (6 dp) per ETH.
    function equivalentStrike(Range memory r) public pure returns (uint256) {
        return Math.sqrt(r.lowUsdc * r.highUsdc);
    }

    function program(Range memory r, uint32 feeBps, uint256 salt) public view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        (uint256 sqrtMin, uint256 sqrtMax) = concentrateBounds(r);
        // Concentrate must run before Fee and Fee before the swap (see swap-vm AquaAccounting tests).
        return bytes.concat(
            p.build(XYCConcentrate._xycConcentrateGrowLiquidity2D, XYCConcentrateArgsBuilder.build2D(sqrtMin, sqrtMax)),
            p.build(Fee._flatFeeAmountInXD, FeeArgsBuilder.buildFlatFee(feeBps)),
            p.build(XYCSwap._xycSwapXD),
            p.build(Controls._salt, abi.encodePacked(salt))
        );
    }

    function aquaOrder(address maker, bytes memory programBytes) public pure returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: maker,
                shouldUnwrapWeth: false,
                useAquaInsteadOfSignature: true,
                allowZeroAmountIn: false,
                receiver: address(0),
                hasPreTransferInHook: false,
                hasPostTransferInHook: false,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: address(0),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: programBytes
            })
        );
    }

    /// @notice Upside curve over [spot, spot * w], holding `ethAmount` ETH and no USDC.
    function upsideCurve(address maker, uint256 spotUsdc, uint256 widthBps, uint256 ethAmount, uint32 feeBps)
        public
        view
        returns (Curve memory c)
    {
        require(widthBps > 10_000, WidthInvalid(widthBps));
        c.range = Range(spotUsdc, spotUsdc * widthBps / 10_000);
        c.order = aquaOrder(maker, program(c.range, feeBps, 1));
        (c.tokens, c.amounts) = _pair(ethAmount, 0);
    }

    /// @notice Downside curve over [spot / w, spot], holding `usdcAmount` USDC and no ETH.
    function downsideCurve(address maker, uint256 spotUsdc, uint256 widthBps, uint256 usdcAmount, uint32 feeBps)
        public
        view
        returns (Curve memory c)
    {
        require(widthBps > 10_000, WidthInvalid(widthBps));
        c.range = Range(spotUsdc * 10_000 / widthBps, spotUsdc);
        c.order = aquaOrder(maker, program(c.range, feeBps, 2));
        (c.tokens, c.amounts) = _pair(0, usdcAmount);
    }

    function _pair(uint256 ethAmount, uint256 usdcAmount) private view returns (address[] memory t, uint256[] memory a) {
        t = new address[](2);
        a = new uint256[](2);
        (t[0], t[1]) = (WETH, USDC);
        (a[0], a[1]) = (ethAmount, usdcAmount);
    }
}
