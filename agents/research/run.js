/**
 * Research Agent - Standalone Runner
 * 
 * Usage:
 *   node run.js --protocol AAVE --lookback 24
 *   DEBUG=nexxore:* node run.js
 */

require('dotenv').config();

const ResearchAgent = require('./agent');

async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const config = {};
  
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];
    config[key] = isNaN(value) ? value : parseInt(value);
  }
  
  // Load API keys from environment
  const apiKeys = {
    coingecko: process.env.COINGECKO_API_KEY,
    newsapi: process.env.NEWS_API_KEY,
    twitter: process.env.TWITTER_API_KEY,
    etherscan: process.env.ETHERSCAN_API_KEY
  };
  
  // Initialize agent
  const agent = new ResearchAgent({
    apiKeys,
    minConfidence: config.confidence || 0.4,
    lookbackHours: config.lookback || 24
  });
  
  console.log('🔬 Research Agent Started');
  console.log(`📊 Agent Metadata:`, agent.getMetadata());
  console.log('');
  
  // Run analysis
  try {
    const context = {
      protocol: config.protocol || null,
      keywords: config.keywords ? config.keywords.split(',') : [],
      lookbackHours: config.lookback || 24
    };
    
    console.log('🔍 Analyzing...', context);
    const result = await agent.analyze(context);
    
    console.log('');
    console.log('✅ Analysis Complete');
    console.log(JSON.stringify(result, null, 2));
    
    // Stream mode (optional continuous monitoring)
    if (config.stream === 'true') {
      console.log('');
      console.log('📡 Streaming mode enabled (update every 5 min)');
      setInterval(async () => {
        const update = await agent.analyze(context);
        console.log(`\n[${new Date().toISOString()}] Update:`, JSON.stringify(update, null, 2));
      }, 5 * 60 * 1000);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
