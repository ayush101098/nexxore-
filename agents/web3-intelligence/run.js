/**
 * Web3 Intelligence Agent - Runner
 * 
 * Usage:
 *   node run.js
 *   DEBUG=nexxore:* node run.js
 */

require('dotenv').config();

const Web3IntelligenceAgent = require('./agent');

async function main() {
  const agent = new Web3IntelligenceAgent({
    apiKeys: {
      coingecko: process.env.COINGECKO_API_KEY,
      newsapi: process.env.NEWS_API_KEY
    }
  });
  
  console.log('🌐 Web3 Intelligence Agent Started');
  console.log(`📊 Agent Metadata:`, agent.getMetadata());
  console.log('');
  
  try {
    console.log('🔍 Generating Web3 Intelligence Report...');
    const report = await agent.generateReport();
    
    console.log('');
    console.log('✅ Report Generated');
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
