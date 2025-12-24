/**
 * Alpha Detection Agent - Runner
 * 
 * Usage:
 *   node run.js --full
 *   DEBUG=nexxore:* node run.js --protocol AAVE
 */

require('dotenv').config();

const AlphaDetectionAgent = require('./agent');

async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const isFull = args.includes('--full');
  const protocolArg = args.find((arg, i) => args[i - 1] === '--protocol');
  
  // Initialize agent
  const agent = new AlphaDetectionAgent({
    apiKeys: {
      coingecko: process.env.COINGECKO_API_KEY,
      newsapi: process.env.NEWS_API_KEY
    }
  });
  
  console.log('🎯 Alpha Detection Agent Started');
  console.log(`📊 Agent Metadata:`, agent.getMetadata());
  console.log('');
  
  try {
    if (protocolArg) {
      // Single protocol analysis
      console.log(`🔍 Analyzing single protocol: ${protocolArg}`);
      const signal = await agent.analyzeProtocol(protocolArg);
      console.log(JSON.stringify(signal, null, 2));
    } else if (isFull) {
      // Full protocol scan
      console.log(`🔍 Scanning ${agent.protocols.length} protocols...`);
      const result = await agent.scanForAlpha();
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Quick scan (top 5 protocols)
      console.log('🔍 Quick scan mode');
      const result = await agent.scanForAlpha();
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
