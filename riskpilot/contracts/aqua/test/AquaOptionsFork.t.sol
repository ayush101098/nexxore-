// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test, console } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";

import { AquaCollateral } from "../src/AquaCollateral.sol";
import { AquaCurves } from "../src/AquaCurves.sol";
import { DemoParams } from "../src/DemoParams.sol";

/// @notice Whole Aqua Options flow on an Ethereum mainnet fork, pinned to DemoParams.FORK_BLOCK,
///         against the deployed AquaSwapVMRouter v1.0.2: fund a maker, check collateral, ship
///         both curves from one wallet, quote, fill each curve, print balances.
///         Run: AQUA_FORK_RPC_URL=<archive mainnet rpc> forge test -vv
contract AquaOptionsForkTest is Test, AquaCurves {
    address constant AQUA = DemoParams.AQUA;
    address constant ROUTER = DemoParams.ROUTER;

    // Unit-test curves: w = 1.10 (~1-day equivalent term). Demo curves live in DemoParams.
    uint256 constant SPOT = 3400e6; // USDC per ETH
    uint256 constant WIDTH_BPS = 11_000; // w = 1.10
    uint32 constant FEE = 0.003e9; // 0.30% flat fee = the maker's premium
    uint256 constant CALL_ETH = 1 ether;

    address maker = makeAddr("maker");
    address taker = makeAddr("taker");

    constructor() AquaCurves(AQUA, DemoParams.WETH, DemoParams.USDC) { }

    function setUp() public {
        vm.createSelectFork(
            vm.envOr("AQUA_FORK_RPC_URL", string("https://ethereum-rpc.publicnode.com")),
            vm.envOr("AQUA_FORK_BLOCK", DemoParams.FORK_BLOCK)
        );
        assertEq(block.number, vm.envOr("AQUA_FORK_BLOCK", DemoParams.FORK_BLOCK), "fork not pinned");

        assertGt(ROUTER.code.length, 0, "router not deployed on this chain");
        assertEq(address(ISwapVMWithAqua(ROUTER).AQUA()), AQUA, "router points at a different Aqua");
        assertEq(IERC20Metadata(WETH).symbol(), "WETH");
        assertEq(IERC20Metadata(USDC).symbol(), "USDC");
        assertEq(IERC20Metadata(USDC).decimals(), 6);

        deal(WETH, maker, 2 ether);
        deal(USDC, maker, 5_000e6);
        vm.startPrank(maker);
        IERC20(WETH).approve(AQUA, type(uint256).max);
        IERC20(USDC).approve(AQUA, type(uint256).max);
        vm.stopPrank();

        deal(USDC, taker, 10_000e6);
        deal(WETH, taker, 5 ether);
        vm.startPrank(taker);
        IERC20(USDC).approve(ROUTER, type(uint256).max);
        IERC20(WETH).approve(ROUTER, type(uint256).max);
        vm.stopPrank();
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /// @notice Cash needed to buy CALL_ETH across the downside range: q * sqrt(low * high).
    function _putUsdc() internal pure returns (uint256) {
        uint256 low = SPOT * 10_000 / WIDTH_BPS;
        return CALL_ETH * Math.sqrt(low * SPOT) / 1e18;
    }

    function _curves() internal view returns (Curve memory up, Curve memory down) {
        up = upsideCurve(maker, SPOT, WIDTH_BPS, CALL_ETH, FEE);
        down = downsideCurve(maker, SPOT, WIDTH_BPS, _putUsdc(), FEE);
    }

    function _plan(Curve memory a, Curve memory b) internal pure returns (AquaCollateral.Shipment[] memory plan) {
        plan = new AquaCollateral.Shipment[](2);
        plan[0] = AquaCollateral.Shipment(a.tokens, a.amounts);
        plan[1] = AquaCollateral.Shipment(b.tokens, b.amounts);
    }

    /// @notice Collateral check, then ship. Refuses (reverts) before any ship if the plan
    ///         would promise more of a token than the maker's wallet can cover.
    function _shipChecked(Curve memory a, Curve memory b) internal returns (bytes32 hashA, bytes32 hashB) {
        AquaCollateral.check(_plan(a, b), maker, AQUA);
        vm.startPrank(maker);
        hashA = IAqua(AQUA).ship(ROUTER, abi.encode(a.order), a.tokens, a.amounts);
        hashB = IAqua(AQUA).ship(ROUTER, abi.encode(b.order), b.tokens, b.amounts);
        vm.stopPrank();
    }

    function _takerData(bool isExactIn) internal view returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: taker,
                isExactIn: isExactIn,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                // Router pulls tokenIn from the taker and pushes it into the maker's Aqua balance.
                useTransferFromAndAquaPush: true,
                threshold: "",
                to: address(0),
                deadline: 0,
                hasPreTransferInCallback: false,
                hasPreTransferOutCallback: false,
                preTransferInHookData: "",
                postTransferInHookData: "",
                preTransferOutHookData: "",
                postTransferOutHookData: "",
                preTransferInCallbackData: "",
                preTransferOutCallbackData: "",
                instructionsArgs: "",
                signature: ""
            })
        );
    }

    function _quote(ISwapVM.Order memory order, address tokenIn, address tokenOut, uint256 amountIn)
        internal
        returns (uint256 amountOut)
    {
        vm.prank(taker);
        (, amountOut,) = ISwapVM(ROUTER).quote(order, tokenIn, tokenOut, amountIn, _takerData(true));
    }

    /// @notice USDC (6 dp) per ETH implied by a USDC -> ETH or ETH -> USDC trade.
    function _price(uint256 usdc, uint256 eth) internal pure returns (uint256) {
        return usdc * 1e18 / eth;
    }

    function _logBalances(string memory label) internal view {
        console.log(label);
        console.log("  maker WETH (1e-18):", IERC20(WETH).balanceOf(maker));
        console.log("  maker USDC (1e-6): ", IERC20(USDC).balanceOf(maker));
        console.log("  taker WETH (1e-18):", IERC20(WETH).balanceOf(taker));
        console.log("  taker USDC (1e-6): ", IERC20(USDC).balanceOf(taker));
    }

    // ── tests ───────────────────────────────────────────────────────────────

    function test_ProgramUsesDocumentedOpcodes() public view {
        bytes memory p = program(Range(SPOT, SPOT * WIDTH_BPS / 10_000), FEE, 1);
        // [opcode][argsLen][args]: concentrate @0 (64-byte args) | flat fee @66 (4) | xycSwap @72 (0) | salt @74
        // Indices follow AquaOpcodes' table order (0x12 concentrate, 0x15 flat fee).
        assertEq(uint8(p[0]), 0x12, "concentrate opcode");
        assertEq(uint8(p[1]), 64, "concentrate args length");
        assertEq(uint8(p[66]), 0x15, "flat fee opcode");
        assertEq(uint8(p[67]), 4, "flat fee args length");
        // 1inch's strategy template encodes the XYCSwap step as 0x11 0x00.
        assertEq(uint8(p[72]), 0x11, "xycSwap opcode");
        assertEq(uint8(p[73]), 0, "xycSwap args length");
    }

    function test_BothCurvesShipFromOneWallet() public {
        (Curve memory up, Curve memory down) = _curves();
        (bytes32 hUp, bytes32 hDown) = _shipChecked(up, down);

        assertEq(hUp, ISwapVM(ROUTER).hash(up.order), "upside strategy hash");
        assertEq(hDown, ISwapVM(ROUTER).hash(down.order), "downside strategy hash");
        (uint256 upWeth, uint256 upUsdc) = IAqua(AQUA).safeBalances(maker, ROUTER, hUp, WETH, USDC);
        (uint256 dnWeth, uint256 dnUsdc) = IAqua(AQUA).safeBalances(maker, ROUTER, hDown, WETH, USDC);
        assertEq(upWeth, CALL_ETH);
        assertEq(upUsdc, 0);
        assertEq(dnWeth, 0);
        assertEq(dnUsdc, _putUsdc());
        // Shipping moves no tokens: Aqua balances are allowances on the maker's wallet.
        assertEq(IERC20(WETH).balanceOf(maker), 2 ether);
        assertEq(IERC20(USDC).balanceOf(maker), 5_000e6);
    }

    function test_QuoteIsConsistentWithTheRange() public {
        (Curve memory up, Curve memory down) = _curves();
        _shipChecked(up, down);

        // Upside: a small buy prices at the range's bottom edge (spot) plus the fee.
        uint256 smallEth = _quote(up.order, USDC, WETH, 100e6);
        uint256 smallPrice = _price(100e6, smallEth);
        assertApproxEqRel(smallPrice, SPOT * (1e9 + FEE) / 1e9, 0.002e18, "upside marginal price");

        // Buying most of the range averages between spot and spot * w, near the equivalent strike.
        uint256 bigEth = _quote(up.order, USDC, WETH, 3_000e6);
        uint256 bigPrice = _price(3_000e6, bigEth);
        assertGt(bigPrice, smallPrice, "price rises as the curve sells ETH");
        assertLt(bigPrice, up.range.highUsdc * (1e9 + FEE) / 1e9, "never above the range top + fee");

        // Downside: a small sell of ETH prices at spot minus the fee.
        uint256 smallUsdc = _quote(down.order, WETH, USDC, 0.01 ether);
        assertApproxEqRel(_price(smallUsdc, 0.01 ether), SPOT * (1e9 - FEE) / 1e9, 0.002e18, "downside marginal price");

        console.log("upside   K_eq (USDC/ETH):", equivalentStrike(up.range));
        console.log("upside   small-buy price:", smallPrice);
        console.log("upside   3000 USDC price:", bigPrice);
        console.log("downside K_eq (USDC/ETH):", equivalentStrike(down.range));
    }

    function test_OneSidedCurveOnlyTradesOneWay() public {
        (Curve memory up, Curve memory down) = _curves();
        _shipChecked(up, down);
        // quote() runs the curve math on virtual reserves only, so it prices the wrong
        // direction too. Callers must cap a quote at the curve's real Aqua balance of tokenOut.
        uint256 quoted = _quote(up.order, WETH, USDC, 0.1 ether);
        assertGt(quoted, 0, "quote prices the wrong direction");
        (, uint256 realUsdc) = IAqua(AQUA).safeBalances(maker, ROUTER, ISwapVM(ROUTER).hash(up.order), WETH, USDC);
        assertEq(realUsdc, 0);

        // The real swap cannot pay USDC the upside curve does not hold: Aqua's pull underflows.
        uint256 makerUsdc = IERC20(USDC).balanceOf(maker);
        vm.prank(taker, taker);
        vm.expectRevert();
        ISwapVM(ROUTER).swap(up.order, WETH, USDC, 0.1 ether, _takerData(true));
        assertEq(IERC20(USDC).balanceOf(maker), makerUsdc, "maker USDC untouched");
    }

    function test_TakerFillMovesTokens() public {
        (Curve memory up, Curve memory down) = _curves();
        (bytes32 hUp,) = _shipChecked(up, down);
        uint256 priceBefore = _price(100e6, _quote(up.order, USDC, WETH, 100e6));

        _logBalances("before fill");
        uint256 makerWeth = IERC20(WETH).balanceOf(maker);
        uint256 makerUsdc = IERC20(USDC).balanceOf(maker);
        uint256 takerWeth = IERC20(WETH).balanceOf(taker);
        uint256 takerUsdc = IERC20(USDC).balanceOf(taker);

        uint256 spend = 1_500e6;
        vm.prank(taker, taker);
        (uint256 amountIn, uint256 amountOut,) = ISwapVM(ROUTER).swap(up.order, USDC, WETH, spend, _takerData(true));
        _logBalances("after fill (taker bought ETH from the upside curve)");

        assertEq(amountIn, spend);
        assertGt(amountOut, 0);
        assertEq(IERC20(WETH).balanceOf(maker), makerWeth - amountOut, "maker ETH out");
        assertEq(IERC20(USDC).balanceOf(maker), makerUsdc + amountIn, "maker USDC in");
        assertEq(IERC20(WETH).balanceOf(taker), takerWeth + amountOut, "taker ETH in");
        assertEq(IERC20(USDC).balanceOf(taker), takerUsdc - amountIn, "taker USDC out");

        (uint256 aquaWeth, uint256 aquaUsdc) = IAqua(AQUA).safeBalances(maker, ROUTER, hUp, WETH, USDC);
        assertEq(aquaWeth, CALL_ETH - amountOut, "curve ETH left");
        assertEq(aquaUsdc, amountIn, "curve now holds the taker's USDC");

        uint256 priceAfter = _price(100e6, _quote(up.order, USDC, WETH, 100e6));
        assertGt(priceAfter, priceBefore, "fill moved the curve's price up");
        console.log("fill price (USDC/ETH):  ", _price(amountIn, amountOut));
        console.log("marginal price before:  ", priceBefore);
        console.log("marginal price after:   ", priceAfter);

        string memory k = "fill";
        vm.serializeUint(k, "amount_in_usdc", amountIn);
        vm.serializeUint(k, "amount_out_weth", amountOut);
        vm.serializeUint(k, "price_before", priceBefore);
        vm.serializeUint(k, "price_after", priceAfter);
        vm.serializeUint(k, "maker_weth_after", IERC20(WETH).balanceOf(maker));
        vm.serializeUint(k, "maker_usdc_after", IERC20(USDC).balanceOf(maker));
        vm.writeJson(vm.serializeBytes32(k, "strategy_hash", hUp), "./out/aqua-fill.json");
    }

    function test_DownsideFillMovesTokens() public {
        (Curve memory up, Curve memory down) = _curves();
        (, bytes32 hDown) = _shipChecked(up, down);
        uint256 priceBefore = _price(_quote(down.order, WETH, USDC, 0.01 ether), 0.01 ether);

        _logBalances("before downside fill");
        uint256 makerWeth = IERC20(WETH).balanceOf(maker);
        uint256 makerUsdc = IERC20(USDC).balanceOf(maker);
        uint256 takerWeth = IERC20(WETH).balanceOf(taker);
        uint256 takerUsdc = IERC20(USDC).balanceOf(taker);

        // Taker sells WETH for USDC: the put-like curve buys ETH with its USDC as price falls.
        uint256 sell = 0.4 ether;
        vm.prank(taker, taker);
        (uint256 amountIn, uint256 amountOut,) = ISwapVM(ROUTER).swap(down.order, WETH, USDC, sell, _takerData(true));
        _logBalances("after downside fill (taker sold ETH to the downside curve)");

        assertEq(amountIn, sell);
        assertGt(amountOut, 0);
        assertEq(IERC20(WETH).balanceOf(maker), makerWeth + amountIn, "maker ETH in");
        assertEq(IERC20(USDC).balanceOf(maker), makerUsdc - amountOut, "maker USDC out");
        assertEq(IERC20(WETH).balanceOf(taker), takerWeth - amountIn, "taker ETH out");
        assertEq(IERC20(USDC).balanceOf(taker), takerUsdc + amountOut, "taker USDC in");

        (uint256 aquaWeth, uint256 aquaUsdc) = IAqua(AQUA).safeBalances(maker, ROUTER, hDown, WETH, USDC);
        assertEq(aquaWeth, amountIn, "curve now holds the taker's ETH");
        assertEq(aquaUsdc, _putUsdc() - amountOut, "curve USDC left");

        uint256 fillPrice = _price(amountOut, amountIn);
        uint256 priceAfter = _price(_quote(down.order, WETH, USDC, 0.01 ether), 0.01 ether);
        assertLt(priceAfter, priceBefore, "fill moved the curve's bid down");
        assertGt(fillPrice, down.range.lowUsdc * (1e9 - FEE) / 1e9, "never below the range bottom - fee");
        console.log("downside fill price (USDC/ETH):", fillPrice);
        console.log("downside bid before:           ", priceBefore);
        console.log("downside bid after:            ", priceAfter);
    }

    function test_DemoCurvesShipAndPriceInRange() public {
        deal(WETH, maker, 2 ether);
        deal(USDC, maker, 5_000e6);
        Curve memory up = upsideCurve(maker, DemoParams.SPOT, DemoParams.WIDTH_BPS, DemoParams.CALL_ETH, DemoParams.UPSIDE_FEE);
        Curve memory down =
            downsideCurve(maker, DemoParams.SPOT, DemoParams.WIDTH_BPS, DemoParams.PUT_USDC, DemoParams.DOWNSIDE_FEE);
        assertEq(up.range.highUsdc, 4335e6, "upside top");
        assertEq(equivalentStrike(up.range) / 1e4, 3839_14, "upside K_eq 3,839.14");
        assertEq(equivalentStrike(down.range) / 1e4, 3011_09, "downside K_eq 3,011.09");
        _shipChecked(up, down);

        // Wider range, same 1 ETH: thinner liquidity, so probe with small sizes for the marginal price.
        uint256 ask = _price(10e6, _quote(up.order, USDC, WETH, 10e6));
        uint256 bid = _price(_quote(down.order, WETH, USDC, 0.001 ether), 0.001 ether);
        assertApproxEqRel(ask, DemoParams.SPOT * (1e9 + DemoParams.UPSIDE_FEE) / 1e9, 0.002e18, "demo ask");
        assertApproxEqRel(bid, DemoParams.SPOT * (1e9 - DemoParams.DOWNSIDE_FEE) / 1e9, 0.002e18, "demo bid");
        console.log("demo ask / bid (USDC/ETH):", ask, bid);
    }

    function test_CollateralCheckRefusesOverAllocation() public {
        // Maker holds 2 ETH; an upside curve promising 3 ETH must not ship.
        Curve memory up = upsideCurve(maker, SPOT, WIDTH_BPS, 3 ether, FEE);
        Curve memory down = downsideCurve(maker, SPOT, WIDTH_BPS, _putUsdc(), FEE);
        vm.expectRevert(abi.encodeWithSelector(AquaCollateral.CollateralExceeded.selector, WETH, 3 ether, 2 ether));
        this.shipCheckedExternal(up, down);
    }

    function test_CollateralCheckSumsCurvesOnTheSameToken() public {
        // Two 1.5 ETH upside curves: each fits alone, together they need 3 ETH > 2 ETH.
        Curve memory a = upsideCurve(maker, SPOT, WIDTH_BPS, 1.5 ether, FEE);
        Curve memory b = upsideCurve(maker, SPOT * 11 / 10, WIDTH_BPS, 1.5 ether, FEE);
        vm.expectRevert(abi.encodeWithSelector(AquaCollateral.CollateralExceeded.selector, WETH, 3 ether, 2 ether));
        this.shipCheckedExternal(a, b);
    }

    function test_CollateralCheckCountsLiveStrategies() public {
        (Curve memory up, Curve memory down) = _curves();
        (bytes32 hUp,) = _shipChecked(up, down);
        // 1 ETH is already promised to the live upside curve; another 1.5 ETH curve exceeds 2 ETH.
        Curve memory extra = upsideCurve(maker, SPOT * 11 / 10, WIDTH_BPS, 1.5 ether, FEE);
        AquaCollateral.Shipment[] memory plan = new AquaCollateral.Shipment[](2);
        plan[0] = AquaCollateral.live(IAqua(AQUA), maker, ROUTER, hUp, up.tokens);
        plan[1] = AquaCollateral.Shipment(extra.tokens, extra.amounts);
        vm.expectRevert(abi.encodeWithSelector(AquaCollateral.CollateralExceeded.selector, WETH, 2.5 ether, 2 ether));
        this.checkExternal(plan);
    }

    function test_CollateralCheckUsesAllowanceToo() public {
        vm.prank(maker);
        IERC20(USDC).approve(AQUA, 1_000e6);
        (Curve memory up, Curve memory down) = _curves();
        vm.expectRevert(abi.encodeWithSelector(AquaCollateral.CollateralExceeded.selector, USDC, _putUsdc(), 1_000e6));
        this.shipCheckedExternal(up, down);
    }

    // External wrappers so vm.expectRevert sees the revert at call depth.
    function shipCheckedExternal(Curve memory a, Curve memory b) external {
        _shipChecked(a, b);
    }

    function checkExternal(AquaCollateral.Shipment[] memory plan) external view {
        AquaCollateral.check(plan, maker, AQUA);
    }
}

interface ISwapVMWithAqua {
    function AQUA() external view returns (address);
}
