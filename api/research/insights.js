// Self-contained protocol analysis without external dependencies
async function analyzeProtocol(protocol) {
  try {
    // Fetch TVL data from DeFi Llama
    const defiUrl = `https://api.llama.fi/protocol/${protocol.toLowerCase()}`;
    const defiResponse = await fetch(defiUrl);
    
    if (!defiResponse.ok) {
      throw new Error(`DeFi Llama API error: ${defiResponse.status}`);
    }
    
    const defiData = await defiResponse.json();
    const tvlHistory = defiData.tvl || [];
    
    if (tvlHistory.length === 0) {
      return null;
    }
    
    const latestTvl = tvlHistory[tvlHistory.length - 1];
    const currentTvl = latestTvl.totalLiquidityUSD || 0;
    
    // Calculate 7-day change
    let tvlChange7d = 0;
    if (tvlHistory.length >= 8) {
      const weekAgo = tvlHistory[tvlHistory.length - 8];
      const previousTvl = weekAgo.totalLiquidityUSD || 0;
      if (previousTvl > 0) {
        tvlChange7d = ((currentTvl - previousTvl) / previousTvl) * 100;
      }
    }
    
    return {
      protocol,
      tvl: currentTvl,
      tvlChange7d,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.error(`Error analyzing ${protocol}:`, err);
    return null;
  }
}

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
        const data = await analyzeProtocol(protocol);
        
        if (!data) {
          return {
            protocol,
            success: false,
            error: 'Failed to fetch data'
          };
        }
        
        // Create signal structure
        const defiSignal = {
          type: 'defi_metrics',
          protocol: protocol,
          tvl: data.tvl,
          tvlChange7d: data.tvlChange7d,
          weight: 0.3
        };
        
        const groupedSignals = {
          news: [],
          sentiment: [{
            type: 'social_sentiment',
            score: 0,
            mentionCount: 0,
            category: 'neutral',
            protocol: protocol,
            weight: 0.2
          }],
          defi: [defiSignal],
          price: []
        };
        
        // Calculate simple confidence based on TVL change
        let confidence = 0;
        if (Math.abs(data.tvlChange7d) > 5) {
          confidence = 0.3;
        }
        if (Math.abs(data.tvlChange7d) > 10) {
          confidence = 0.5;
        }
        
        const summary = data.tvlChange7d > 0 
          ? `${protocol.toUpperCase()}: Positive TVL growth (+${data.tvlChange7d.toFixed(2)}%)`
          : data.tvlChange7d < -5
          ? `${protocol.toUpperCase()}: Declining TVL (${data.tvlChange7d.toFixed(2)}%)`
          : `${protocol.toUpperCase()}: Stable TVL`;
        
        return {
          protocol,
          success: true,
          signals: groupedSignals,
          type: 'research_analysis',
          insights: [],
          summary,
          signalsAnalyzed: 2,
          executionTimeMs: 0,
          timestamp: new Date().toISOString(),
          confidence
        };
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
