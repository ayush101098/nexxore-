/**
 * Analytics Platform Test Script
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Test and demo script for the multi-source data fetcher.
 * Run this to verify all data sources are working.
 * 
 * Usage: node testAnalyticsPlatforms.js
 */

const { multiSourceFetcher } = require('./multiSourceDataFetcher');
const { analyticsCollector } = require('./analyticsPlatformCollectors');

// ═══════════════════════════════════════════════════════════════════════════
//                              TEST FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function testDefiLlama() {
    console.log('\n' + '═'.repeat(70));
    console.log('📊 TESTING DEFILLAMA (No API Key Required)');
    console.log('═'.repeat(70));

    try {
        // Test protocols
        console.log('\n🔹 Fetching all protocols...');
        const protocols = await multiSourceFetcher.getDefiLlamaProtocols();
        console.log(`   ✅ Found ${protocols.length} protocols`);
        console.log(`   Top 5 by TVL:`);
        protocols.slice(0, 5).forEach((p, i) => {
            console.log(`      ${i + 1}. ${p.name}: $${(p.tvl / 1e9).toFixed(2)}B TVL`);
        });

        // Test yields
        console.log('\n🔹 Fetching yield pools...');
        const yields = await multiSourceFetcher.getDefiLlamaYields();
        console.log(`   ✅ Found ${yields.length} yield pools`);
        const topYields = yields
            .filter(y => y.apy > 0 && y.apy < 100 && y.tvlUsd > 1000000)
            .sort((a, b) => b.apy - a.apy)
            .slice(0, 5);
        console.log(`   Top 5 yields (>$1M TVL):`);
        topYields.forEach((y, i) => {
            console.log(`      ${i + 1}. ${y.project}/${y.symbol}: ${y.apy.toFixed(2)}% APY`);
        });

        // Test stablecoins
        console.log('\n🔹 Fetching stablecoin data...');
        const stables = await multiSourceFetcher.getDefiLlamaStablecoins();
        const totalStables = stables?.peggedAssets?.reduce((sum, s) => sum + (s.circulating?.peggedUSD || 0), 0);
        console.log(`   ✅ Total stablecoin supply: $${(totalStables / 1e9).toFixed(2)}B`);

        // Test fees
        console.log('\n🔹 Fetching protocol fees...');
        const fees = await multiSourceFetcher.getDefiLlamaFees();
        console.log(`   ✅ Total 24h fees: $${((fees?.total24h || 0) / 1e6).toFixed(2)}M`);

        // Test DEX volumes
        console.log('\n🔹 Fetching DEX volumes...');
        const dex = await multiSourceFetcher.getDefiLlamaDEXVolumes();
        console.log(`   ✅ Total 24h DEX volume: $${((dex?.total24h || 0) / 1e9).toFixed(2)}B`);

        return true;
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return false;
    }
}

async function testDexScreener() {
    console.log('\n' + '═'.repeat(70));
    console.log('📈 TESTING DEXSCREENER (No API Key Required)');
    console.log('═'.repeat(70));

    try {
        // Test search
        console.log('\n🔹 Searching for AAVE pairs...');
        const aavePairs = await multiSourceFetcher.searchDexScreener('AAVE');
        console.log(`   ✅ Found ${aavePairs?.pairs?.length || 0} AAVE pairs`);
        
        if (aavePairs?.pairs?.length > 0) {
            const topPair = aavePairs.pairs[0];
            console.log(`   Top pair: ${topPair.baseToken?.symbol}/${topPair.quoteToken?.symbol} on ${topPair.chainId}`);
            console.log(`   Price: $${parseFloat(topPair.priceUsd).toFixed(4)}`);
            console.log(`   24h Volume: $${((topPair.volume?.h24 || 0) / 1e6).toFixed(2)}M`);
        }

        // Test trending
        console.log('\n🔹 Fetching trending tokens...');
        const trending = await multiSourceFetcher.getDexScreenerTrending();
        console.log(`   ✅ Found ${trending?.length || 0} trending/boosted tokens`);

        return true;
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return false;
    }
}

async function testEtherscan() {
    console.log('\n' + '═'.repeat(70));
    console.log('🔗 TESTING ETHERSCAN (API Key Optional)');
    console.log('═'.repeat(70));

    try {
        // Test gas prices
        console.log('\n🔹 Fetching gas prices...');
        const gas = await multiSourceFetcher.getEtherscanGas();
        if (gas) {
            console.log(`   ✅ Current gas prices:`);
            console.log(`      Safe: ${gas.SafeGasPrice} Gwei`);
            console.log(`      Propose: ${gas.ProposeGasPrice} Gwei`);
            console.log(`      Fast: ${gas.FastGasPrice} Gwei`);
        } else {
            console.log(`   ⚠️ Gas data not available (may need API key)`);
        }

        return true;
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return false;
    }
}

async function testCollectors() {
    console.log('\n' + '═'.repeat(70));
    console.log('🎯 TESTING ANALYTICS PLATFORM COLLECTORS');
    console.log('═'.repeat(70));

    try {
        // Test TVL collector
        console.log('\n🔹 Testing TVL Health Collector...');
        const tvlData = await analyticsCollector.tvl.getGlobalTVL();
        console.log(`   ✅ Total DeFi TVL: $${(tvlData.totalTvl / 1e9).toFixed(2)}B`);
        console.log(`   TVL Trend: ${tvlData.signals.tvlTrend}`);
        console.log(`   Hot Category: ${tvlData.signals.hotCategory}`);

        // Test Yield collector
        console.log('\n🔹 Testing Yield Revenue Collector...');
        const yieldData = await analyticsCollector.yields.getTopYields(1000000, 10);
        console.log(`   ✅ Average APY (top pools): ${yieldData.signals.avgApy.toFixed(2)}%`);
        console.log(`   Sustainable yields: ${yieldData.signals.sustainableYields}/${yieldData.yields.length}`);

        // Test DEX collector
        console.log('\n🔹 Testing DEX Trading Collector...');
        const dexData = await analyticsCollector.dex.getDEXVolumes();
        console.log(`   ✅ Spot DEX 24h: $${((dexData.spotDEX.total24h || 0) / 1e9).toFixed(2)}B`);
        console.log(`   Derivatives 24h: $${((dexData.derivatives.total24h || 0) / 1e9).toFixed(2)}B`);
        console.log(`   Top DEX: ${dexData.signals.topDEX}`);
        console.log(`   Top Perp: ${dexData.signals.topPerp}`);

        // Test Stablecoin collector
        console.log('\n🔹 Testing Stablecoin Collector...');
        const stableData = await analyticsCollector.stablecoins.getStablecoinData();
        console.log(`   ✅ Total Supply: $${(stableData.totalSupply / 1e9).toFixed(2)}B`);
        console.log(`   Supply Growing: ${stableData.signals.supplyGrowing}`);
        console.log(`   Dominant: ${stableData.signals.dominantStable}`);

        // Test Bridge collector
        console.log('\n🔹 Testing Bridge Collector...');
        const bridgeData = await analyticsCollector.bridges.getBridgeData();
        console.log(`   ✅ Total Bridge Volume 24h: $${((bridgeData.signals.totalVolume24h || 0) / 1e6).toFixed(2)}M`);
        console.log(`   Top Bridge: ${bridgeData.signals.topBridge}`);
        console.log(`   Volume Trend: ${bridgeData.signals.volumeTrend}`);

        // Test Fundraising collector
        console.log('\n🔹 Testing Fundraising Collector...');
        const fundData = await analyticsCollector.fundraising.getFundraisingData();
        console.log(`   ✅ Raises (30d): ${fundData.raisesCount30d}`);
        console.log(`   Total Raised (30d): $${(fundData.totalRaised30d / 1e6).toFixed(2)}M`);
        console.log(`   Potential Airdrops: ${fundData.potentialAirdrops?.length || 0} projects`);

        return true;
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        console.error(error);
        return false;
    }
}

async function testCompleteSnapshot() {
    console.log('\n' + '═'.repeat(70));
    console.log('📸 TESTING COMPLETE MARKET SNAPSHOT');
    console.log('═'.repeat(70));

    try {
        console.log('\n🔹 Fetching complete snapshot (this may take 10-20 seconds)...');
        const snapshot = await analyticsCollector.getCompleteSnapshot();
        
        console.log(`\n   ✅ Snapshot collected from: ${snapshot.sources.join(', ')}`);
        console.log(`\n   📊 MARKET OVERVIEW:`);
        console.log(`      Total DeFi TVL: $${(snapshot.tvl.totalTvl / 1e9).toFixed(2)}B`);
        console.log(`      24h DEX Volume: $${((snapshot.dex.spotDEX.total24h || 0) / 1e9).toFixed(2)}B`);
        console.log(`      24h Perp Volume: $${((snapshot.dex.derivatives.total24h || 0) / 1e9).toFixed(2)}B`);
        console.log(`      Stablecoin Supply: $${(snapshot.stablecoins.totalSupply / 1e9).toFixed(2)}B`);
        
        console.log(`\n   🎯 MARKET SIGNALS:`);
        console.log(`      TVL Trend: ${snapshot.marketSignals.tvlTrend}`);
        console.log(`      Volume Trend: ${snapshot.marketSignals.volumeTrend}`);
        console.log(`      Stablecoin Supply: ${snapshot.marketSignals.stablecoinSupply}`);
        console.log(`      Overall Sentiment: ${snapshot.marketSignals.overall}`);

        return true;
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        console.error(error);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//                              MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

async function runAllTests() {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║           ANALYTICS PLATFORM DATA FETCHER - TEST SUITE                   ║');
    console.log('║                                                                           ║');
    console.log('║  Testing data collection from:                                           ║');
    console.log('║  • DeFiLlama (TVL, Yields, Fees, Stablecoins, Bridges)                  ║');
    console.log('║  • DexScreener (Token Pairs, Trending)                                   ║');
    console.log('║  • Etherscan (Gas, Transactions)                                         ║');
    console.log('║  • Specialized Collectors (TVL, Yields, DEX, Onchain, Bridges)          ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝');

    const results = {
        defillama: await testDefiLlama(),
        dexscreener: await testDexScreener(),
        etherscan: await testEtherscan(),
        collectors: await testCollectors(),
        snapshot: await testCompleteSnapshot()
    };

    console.log('\n' + '═'.repeat(70));
    console.log('📋 TEST RESULTS SUMMARY');
    console.log('═'.repeat(70));
    
    Object.entries(results).forEach(([test, passed]) => {
        console.log(`   ${passed ? '✅' : '❌'} ${test.toUpperCase()}`);
    });

    const allPassed = Object.values(results).every(r => r);
    console.log('\n' + (allPassed 
        ? '🎉 All tests passed! Data fetching is working correctly.'
        : '⚠️ Some tests failed. Check API keys or network connectivity.'));

    console.log('\n');
}

// Run if called directly
if (require.main === module) {
    runAllTests().catch(console.error);
}

module.exports = { runAllTests };
