const ResearchAgent = require('../agents/research/agent');
const AlphaDetectionAgent = require('../agents/alpha/agent');
const Web3IntelligenceAgent = require('../agents/web3-intelligence/agent');

const researchAgent = new ResearchAgent({
  apiKeys: {
    coingecko: process.env.COINGECKO_API_KEY,
    newsapi: process.env.NEWS_API_KEY
  }
});

const alphaAgent = new AlphaDetectionAgent({
  apiKeys: {
    coingecko: process.env.COINGECKO_API_KEY,
    newsapi: process.env.NEWS_API_KEY
  }
});

const web3Agent = new Web3IntelligenceAgent({
  apiKeys: {
    coingecko: process.env.COINGECKO_API_KEY,
    newsapi: process.env.NEWS_API_KEY
  }
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.status(200).json({
    status: 'operational',
    timestamp: new Date().toISOString(),
    agents: {
      research: researchAgent.getMetadata(),
      alpha: alphaAgent.getMetadata(),
      web3: web3Agent.getMetadata()
    }
  });
};
