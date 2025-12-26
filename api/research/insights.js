const ResearchAgent = require('../../agents/research/agent');

const researchAgent = new ResearchAgent({
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

  try {
    const protocols = req.query.protocols || 'aave,curve,uniswap';
    const protocolList = protocols.split(',').map(p => p.trim());
    
    console.log('🔍 Analyzing protocols:', protocolList);
    
    const results = await Promise.all(
      protocolList.map(async (protocol) => {
        try {
          // Gather signals first
          const signals = await researchAgent.gatherSignals([protocol], 24);
          
          console.log(`📊 Signals for ${protocol}:`, signals.length, 'signals collected');
          
          // Group by type for better organization
          const groupedSignals = {
            news: signals.filter(s => s.type === 'news'),
            sentiment: signals.filter(s => s.type === 'social_sentiment'),
            defi: signals.filter(s => s.type === 'defi_metrics'),
            price: signals.filter(s => s.type === 'price_momentum')
          };
          
          // Run analysis
          const result = await researchAgent.analyze({ 
            protocol,
            keywords: [protocol],
            lookbackHours: 24
          });
          
          return {
            protocol,
            success: true,
            signals: groupedSignals,
            ...result
          };
        } catch (err) {
          console.error(`Error analyzing ${protocol}:`, err);
          return {
            protocol,
            success: false,
            error: err.message
          };
        }
      })
    );
    
    res.status(200).json({ 
      insights: results.filter(r => r.success),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error generating research insights:', err);
    res.status(500).json({ error: err.message, insights: [] });
  }
};
