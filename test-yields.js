const axios = require('axios');

async function test() {
  console.log('Fetching DeFi Llama yields...');
  const { data } = await axios.get('https://yields.llama.fi/pools', { timeout: 20000 });
  const pools = data.data;
  console.log('Total pools:', pools.length);

  const filters = [
    ['aave-v3', 'aave-v3', 'USDC'],
    ['compound-v3', 'compound-v3', 'USDC'],
    ['maker-sdai', 'makerdao', 'DAI'],
    ['lido', 'lido', 'STETH']
  ];

  let blended = 0;
  const weights = { 'aave-v3': 40, 'compound-v3': 25, 'maker-sdai': 25, 'lido': 10 };

  for (const [key, proj, sym] of filters) {
    const matches = pools.filter(p =>
      p.project === proj && p.chain === 'Ethereum' &&
      p.symbol && p.symbol.toUpperCase().includes(sym)
    ).sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0));

    const best = matches[0];
    if (best) {
      const apy = best.apy || best.apyBase || 0;
      blended += apy * (weights[key] / 100);
      console.log(`✅ ${key}: APY=${apy.toFixed(2)}%  TVL=$${(best.tvlUsd / 1e6).toFixed(0)}M  symbol=${best.symbol}`);
    } else {
      console.log(`❌ ${key}: NOT FOUND`);
    }
  }

  console.log(`\n📊 Blended APY: ${blended.toFixed(2)}%`);
}

test().catch(e => console.error('Error:', e.message));
