/**
 * Test API keys and data sources
 */

const axios = require('axios');

const MESSARI_KEY = 'XFt9ZK6NwVSRovOVTtkNmxydSRdqLlIqnQQsjlpArr+dK-uL';
const COINGECKO_KEY = 'XFt9ZK6NwVSRovOVTtkNmxydSRdqLlIqnQQsjlpArr+dK-uL';

async function testCoinGecko() {
  console.log('\n🦎 Testing CoinGecko API...');
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/coins/bitcoin', {
      params: {
        localization: false,
        tickers: false,
        market_data: true,
        community_data: false,
        developer_data: false
      },
      headers: COINGECKO_KEY ? { 'x-cg-pro-api-key': COINGECKO_KEY } : {},
      timeout: 10000
    });

    const data = response.data;
    const marketData = data.market_data;

    console.log('✅ CoinGecko Response:');
    console.log('   Price:', marketData?.current_price?.usd);
    console.log('   Market Cap:', marketData?.market_cap?.usd);
    console.log('   24h Volume:', marketData?.total_volume?.usd);
    console.log('   24h Change:', marketData?.price_change_percentage_24h?.toFixed(2) + '%');
    console.log('   7d Change:', marketData?.price_change_percentage_7d?.toFixed(2) + '%');
    return true;
  } catch (error) {
    console.error('❌ CoinGecko Error:', error.response?.status, error.message);
    return false;
  }
}

async function testMessari() {
  console.log('\n📰 Testing Messari API...');
  try {
    const response = await axios.get('https://data.messari.io/api/v1/assets/bitcoin/metrics', {
      headers: MESSARI_KEY ? { 'x-messari-api-key': MESSARI_KEY } : {},
      timeout: 10000
    });

    const data = response.data?.data;
    console.log('✅ Messari Response:');
    console.log('   Price:', data.market_data?.price_usd);
    console.log('   Market Cap:', data.marketcap?.current_marketcap_usd);
    console.log('   24h Volume:', data.market_data?.volume_last_24_hours);
    console.log('   24h Change:', data.market_data?.percent_change_usd_last_24_hours?.toFixed(2) + '%');
    return true;
  } catch (error) {
    console.error('❌ Messari Error:', error.response?.status, error.message);
    return false;
  }
}

async function testHyperLiquid() {
  console.log('\n🔥 Testing HyperLiquid API...');
  try {
    // Get meta data
    const metaRes = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'meta'
    }, { timeout: 10000 });

    // Get current prices
    const midsRes = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'allMids'
    }, { timeout: 10000 });

    console.log('✅ HyperLiquid Response:');
    console.log('   Markets:', metaRes.data?.universe?.length);
    console.log('   BTC Price:', midsRes.data?.[0]);
    console.log('   ETH Price:', midsRes.data?.[1]);
    console.log('   SOL Price:', midsRes.data?.[2]);
    return true;
  } catch (error) {
    console.error('❌ HyperLiquid Error:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🧪 Testing Perps Intelligence API Data Sources\n');
  console.log('='.repeat(50));

  const results = {
    coingecko: await testCoinGecko(),
    messari: await testMessari(),
    hyperliquid: await testHyperLiquid()
  };

  console.log('\n' + '='.repeat(50));
  console.log('\n📊 Test Summary:');
  console.log('   CoinGecko:', results.coingecko ? '✅ Working' : '❌ Failed');
  console.log('   Messari:', results.messari ? '✅ Working' : '❌ Failed');
  console.log('   HyperLiquid:', results.hyperliquid ? '✅ Working' : '❌ Failed');
  console.log('');

  const working = Object.values(results).filter(Boolean).length;
  console.log(`${working}/3 data sources operational\n`);
}

runTests();
